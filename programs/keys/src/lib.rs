//! socialLiquid keys on Solana.
//!
//! A key is a share in a trader, and the pass to their private feed. Each trader who lists picks their key's
//! starting price and gets their own capped supply on a linear bonding curve from there, priced in USDC: every
//! key costs `slope` more than the one before. Buying pays the curve price plus a protocol fee: `trader_cut_bps` of the curve price goes to
//! the trader at once and the rest stays in the program's vault as that trader's reserve. Selling refunds exactly
//! the reserve share of the same curve range, minus the protocol fee, so the reserve always covers every
//! outstanding key and any holder can always exit. The trader cut is fixed at initialisation for that reason.
//!
//! Holders also earn: anyone (in practice the socialLiquid distributor) deposits USDC against a trader, and it is
//! split across that trader's holders pro rata to the keys held at the moment of the deposit.
//!
//! Buying can be paused by the admin. Selling and claiming never can.
//!
//! Events are emitted as a CPI into this program (instruction 255, signed by the event authority PDA), so an
//! indexer reads them from inner instructions, which unlike logs are never truncated.

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};

#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
mod system_program {
    pub const ID: solana_program::pubkey::Pubkey = solana_program::pubkey!("11111111111111111111111111111111");
}

pub const SUPPLY_CAP: u64 = 2000;
pub const MAX_PROTOCOL_FEE_BPS: u16 = 500;
/// the most a trader can start their key at: 1000 USDC
pub const MAX_BASE_PRICE: u64 = 1_000_000_000;
const BPS: u128 = 10_000;
const ACC: u128 = 1_000_000_000_000_000_000;

pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const TRADER_SEED: &[u8] = b"trader";
pub const HOLDER_SEED: &[u8] = b"holder";
pub const EVENT_SEED: &[u8] = b"__event_authority";

const CONFIG_DISC: &[u8; 8] = b"SLKCONF1";
const TRADER_DISC: &[u8; 8] = b"SLKTRDR1";
const HOLDER_DISC: &[u8; 8] = b"SLKHLDR1";
pub const CONFIG_LEN: usize = 128;
pub const TRADER_LEN: usize = 88;
pub const HOLDER_LEN: usize = 112;
const TOKEN_ACCOUNT_LEN: usize = 165;
const MINT_LEN: usize = 82;

/// custom error codes, mirrored in the client
#[repr(u32)]
#[derive(Clone, Copy, Debug)]
pub enum KeysError {
    NotAdmin = 0,
    NotListed = 1,
    AlreadyListed = 2,
    ZeroAmount = 3,
    SupplyCap = 4,
    Slippage = 5,
    Insufficient = 6,
    NoHolders = 7,
    Paused = 8,
    BadConfig = 9,
    BadAccount = 10,
    Math = 11,
    NotEmpty = 12,
    AlreadyInitialized = 13,
    BadPrice = 14,
}

impl From<KeysError> for ProgramError {
    fn from(e: KeysError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

fn err(e: KeysError) -> ProgramError {
    e.into()
}

// ---------------------------------------------------------------- state

pub struct Config {
    pub admin: Pubkey,
    pub treasury_usdc: Pubkey,
    pub usdc_mint: Pubkey,
    /// the lowest starting price a trader may choose
    pub min_base_price: u64,
    /// price added per key already in supply, the same for every trader
    pub slope: u64,
    pub trader_cut_bps: u16,
    pub protocol_fee_bps: u16,
    pub buys_paused: bool,
    pub bump: u8,
    pub vault_bump: u8,
    pub event_bump: u8,
}

pub struct Trader {
    pub trader: Pubkey,
    pub supply: u64,
    /// USDC held to buy back every outstanding key
    pub reserve: u64,
    /// cumulative fee share per key, scaled by 1e18
    pub acc_per_key: u128,
    pub bump: u8,
    /// the price of this trader's first key, chosen when they listed and fixed after: the reserve owes each
    /// holder what their keys put in, so the curve can never move under them
    pub base_price: u64,
}

pub struct Holder {
    pub trader: Pubkey,
    pub holder: Pubkey,
    pub balance: u64,
    pub reward_debt: u128,
    pub owed: u64,
    pub bump: u8,
}

fn pk(d: &[u8], at: usize) -> Pubkey {
    Pubkey::new_from_array(d[at..at + 32].try_into().unwrap())
}
fn u64_at(d: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(d[at..at + 8].try_into().unwrap())
}
fn u128_at(d: &[u8], at: usize) -> u128 {
    u128::from_le_bytes(d[at..at + 16].try_into().unwrap())
}
fn u16_at(d: &[u8], at: usize) -> u16 {
    u16::from_le_bytes(d[at..at + 2].try_into().unwrap())
}

impl Config {
    fn read(d: &[u8]) -> Result<Self, ProgramError> {
        if d.len() != CONFIG_LEN || &d[0..8] != CONFIG_DISC {
            return Err(err(KeysError::BadAccount));
        }
        Ok(Config {
            admin: pk(d, 8),
            treasury_usdc: pk(d, 40),
            usdc_mint: pk(d, 72),
            min_base_price: u64_at(d, 104),
            slope: u64_at(d, 112),
            trader_cut_bps: u16_at(d, 120),
            protocol_fee_bps: u16_at(d, 122),
            buys_paused: d[124] != 0,
            bump: d[125],
            vault_bump: d[126],
            event_bump: d[127],
        })
    }
    fn write(&self, d: &mut [u8]) {
        d[0..8].copy_from_slice(CONFIG_DISC);
        d[8..40].copy_from_slice(self.admin.as_ref());
        d[40..72].copy_from_slice(self.treasury_usdc.as_ref());
        d[72..104].copy_from_slice(self.usdc_mint.as_ref());
        d[104..112].copy_from_slice(&self.min_base_price.to_le_bytes());
        d[112..120].copy_from_slice(&self.slope.to_le_bytes());
        d[120..122].copy_from_slice(&self.trader_cut_bps.to_le_bytes());
        d[122..124].copy_from_slice(&self.protocol_fee_bps.to_le_bytes());
        d[124] = self.buys_paused as u8;
        d[125] = self.bump;
        d[126] = self.vault_bump;
        d[127] = self.event_bump;
    }

    /// the curve price of `amount` keys starting at `supply` for a key starting at `base`: the sum of
    /// base + slope * k over that range
    pub fn curve_cost(&self, base: u64, supply: u64, amount: u64) -> Result<u64, ProgramError> {
        let (s, a) = (supply as u128, amount as u128);
        let steps = a.checked_mul(s).and_then(|x| x.checked_add(a * a.saturating_sub(1) / 2)).ok_or(err(KeysError::Math))?;
        let cost = a
            .checked_mul(base as u128)
            .and_then(|x| x.checked_add((self.slope as u128).checked_mul(steps)?))
            .ok_or(err(KeysError::Math))?;
        u64::try_from(cost).map_err(|_| err(KeysError::Math))
    }
    pub fn trader_cut_of(&self, cost: u64) -> u64 {
        ((cost as u128) * (self.trader_cut_bps as u128) / BPS) as u64
    }
    pub fn fee_of(&self, amount: u64) -> u64 {
        ((amount as u128) * (self.protocol_fee_bps as u128) / BPS) as u64
    }
}

impl Trader {
    fn read(d: &[u8]) -> Result<Self, ProgramError> {
        if d.len() != TRADER_LEN || &d[0..8] != TRADER_DISC {
            return Err(err(KeysError::BadAccount));
        }
        Ok(Trader { trader: pk(d, 8), supply: u64_at(d, 40), reserve: u64_at(d, 48), acc_per_key: u128_at(d, 56), bump: d[72], base_price: u64_at(d, 80) })
    }
    fn write(&self, d: &mut [u8]) {
        d[0..8].copy_from_slice(TRADER_DISC);
        d[8..40].copy_from_slice(self.trader.as_ref());
        d[40..48].copy_from_slice(&self.supply.to_le_bytes());
        d[48..56].copy_from_slice(&self.reserve.to_le_bytes());
        d[56..72].copy_from_slice(&self.acc_per_key.to_le_bytes());
        d[72] = self.bump;
        d[80..88].copy_from_slice(&self.base_price.to_le_bytes());
    }
}

impl Holder {
    fn read(d: &[u8]) -> Result<Self, ProgramError> {
        if d.len() != HOLDER_LEN || &d[0..8] != HOLDER_DISC {
            return Err(err(KeysError::BadAccount));
        }
        Ok(Holder { trader: pk(d, 8), holder: pk(d, 40), balance: u64_at(d, 72), reward_debt: u128_at(d, 80), owed: u64_at(d, 96), bump: d[104] })
    }
    fn write(&self, d: &mut [u8]) {
        d[0..8].copy_from_slice(HOLDER_DISC);
        d[8..40].copy_from_slice(self.trader.as_ref());
        d[40..72].copy_from_slice(self.holder.as_ref());
        d[72..80].copy_from_slice(&self.balance.to_le_bytes());
        d[80..96].copy_from_slice(&self.reward_debt.to_le_bytes());
        d[96..104].copy_from_slice(&self.owed.to_le_bytes());
        d[104] = self.bump;
    }
    /// move everything accrued since the last checkpoint into `owed`, before the balance changes
    fn settle(&mut self, acc_per_key: u128) -> Result<(), ProgramError> {
        let accrued = (self.balance as u128).checked_mul(acc_per_key).ok_or(err(KeysError::Math))? / ACC;
        let gain = accrued.checked_sub(self.reward_debt).ok_or(err(KeysError::Math))?;
        self.owed = self.owed.checked_add(u64::try_from(gain).map_err(|_| err(KeysError::Math))?).ok_or(err(KeysError::Math))?;
        Ok(())
    }
    fn checkpoint(&mut self, acc_per_key: u128) -> Result<(), ProgramError> {
        self.reward_debt = (self.balance as u128).checked_mul(acc_per_key).ok_or(err(KeysError::Math))? / ACC;
        Ok(())
    }
}

// ---------------------------------------------------------------- account checks

fn signer(a: &AccountInfo) -> ProgramResult {
    if !a.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    Ok(())
}

fn key_is(a: &AccountInfo, expected: &Pubkey) -> ProgramResult {
    if a.key != expected {
        return Err(err(KeysError::BadAccount));
    }
    Ok(())
}

fn pda(seeds: &[&[u8]], program_id: &Pubkey) -> Result<Pubkey, ProgramError> {
    Pubkey::create_program_address(seeds, program_id).map_err(|_| err(KeysError::BadAccount))
}

fn load_config(program_id: &Pubkey, a: &AccountInfo) -> Result<Config, ProgramError> {
    if a.owner != program_id {
        return Err(err(KeysError::BadAccount));
    }
    let c = Config::read(&a.try_borrow_data()?)?;
    key_is(a, &pda(&[CONFIG_SEED, &[c.bump]], program_id)?)?;
    Ok(c)
}

fn load_trader(program_id: &Pubkey, a: &AccountInfo) -> Result<Trader, ProgramError> {
    if a.owner != program_id || a.data_len() == 0 {
        return Err(err(KeysError::NotListed));
    }
    let t = Trader::read(&a.try_borrow_data()?)?;
    key_is(a, &pda(&[TRADER_SEED, t.trader.as_ref(), &[t.bump]], program_id)?)?;
    Ok(t)
}

/// an existing holder record for (trader, holder); `None` when the account was never created
fn load_holder(program_id: &Pubkey, a: &AccountInfo, trader: &Pubkey, holder: &Pubkey) -> Result<Option<Holder>, ProgramError> {
    if a.data_len() == 0 && a.owner == &system_program::ID {
        let (expected, _) = Pubkey::find_program_address(&[HOLDER_SEED, trader.as_ref(), holder.as_ref()], program_id);
        key_is(a, &expected)?;
        return Ok(None);
    }
    if a.owner != program_id {
        return Err(err(KeysError::BadAccount));
    }
    let h = Holder::read(&a.try_borrow_data()?)?;
    if &h.trader != trader || &h.holder != holder {
        return Err(err(KeysError::BadAccount));
    }
    key_is(a, &pda(&[HOLDER_SEED, trader.as_ref(), holder.as_ref(), &[h.bump]], program_id)?)?;
    Ok(Some(h))
}

/// an initialised SPL token account: (mint, owner)
fn token_account(a: &AccountInfo) -> Result<(Pubkey, Pubkey), ProgramError> {
    if a.owner != &TOKEN_PROGRAM_ID || a.data_len() != TOKEN_ACCOUNT_LEN {
        return Err(err(KeysError::BadAccount));
    }
    let d = a.try_borrow_data()?;
    if d[108] != 1 {
        return Err(err(KeysError::BadAccount));
    }
    Ok((pk(&d, 0), pk(&d, 32)))
}

fn usdc_account(a: &AccountInfo, c: &Config) -> Result<Pubkey, ProgramError> {
    let (mint, owner) = token_account(a)?;
    if mint != c.usdc_mint {
        return Err(err(KeysError::BadAccount));
    }
    Ok(owner)
}

fn vault_check(program_id: &Pubkey, a: &AccountInfo, c: &Config) -> ProgramResult {
    key_is(a, &pda(&[VAULT_SEED, &[c.vault_bump]], program_id)?)
}

fn programs_check(token_program: &AccountInfo) -> ProgramResult {
    key_is(token_program, &TOKEN_PROGRAM_ID)
}

// ---------------------------------------------------------------- cpi helpers

fn token_transfer<'a>(token_program: &AccountInfo<'a>, from: &AccountInfo<'a>, to: &AccountInfo<'a>, authority: &AccountInfo<'a>, amount: u64, seeds: Option<&[&[u8]]>) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    let mut data = Vec::with_capacity(9);
    data.push(3u8);
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: TOKEN_PROGRAM_ID,
        accounts: vec![AccountMeta::new(*from.key, false), AccountMeta::new(*to.key, false), AccountMeta::new_readonly(*authority.key, true)],
        data,
    };
    let infos = [from.clone(), to.clone(), authority.clone(), token_program.clone()];
    match seeds {
        Some(s) => invoke_signed(&ix, &infos, &[s]),
        None => invoke(&ix, &infos),
    }
}

fn system_ix(tag: u32, rest: &[u8], accounts: Vec<AccountMeta>) -> Instruction {
    let mut data = tag.to_le_bytes().to_vec();
    data.extend_from_slice(rest);
    Instruction { program_id: system_program::ID, accounts, data }
}

/// create a program-owned PDA. tolerates lamports sent to the address beforehand (which would make a plain
/// CreateAccount fail): tops up, allocates and assigns instead
fn create_pda<'a>(payer: &AccountInfo<'a>, target: &AccountInfo<'a>, system: &AccountInfo<'a>, seeds: &[&[u8]], space: usize, owner: &Pubkey) -> ProgramResult {
    key_is(system, &system_program::ID)?;
    let need = Rent::get()?.minimum_balance(space);
    if target.lamports() == 0 {
        let mut rest = need.to_le_bytes().to_vec();
        rest.extend_from_slice(&(space as u64).to_le_bytes());
        rest.extend_from_slice(owner.as_ref());
        let ix = system_ix(0, &rest, vec![AccountMeta::new(*payer.key, true), AccountMeta::new(*target.key, true)]);
        return invoke_signed(&ix, &[payer.clone(), target.clone(), system.clone()], &[seeds]);
    }
    if target.lamports() < need {
        let ix = system_ix(2, &(need - target.lamports()).to_le_bytes(), vec![AccountMeta::new(*payer.key, true), AccountMeta::new(*target.key, false)]);
        invoke(&ix, &[payer.clone(), target.clone(), system.clone()])?;
    }
    let ix = system_ix(8, &(space as u64).to_le_bytes(), vec![AccountMeta::new(*target.key, true)]);
    invoke_signed(&ix, &[target.clone(), system.clone()], &[seeds])?;
    let ix = system_ix(1, owner.as_ref(), vec![AccountMeta::new(*target.key, true)]);
    invoke_signed(&ix, &[target.clone(), system.clone()], &[seeds])
}

/// emit an event as a self-CPI signed by the event authority
fn emit<'a>(program_id: &Pubkey, c: &Config, event_authority: &AccountInfo<'a>, program: &AccountInfo<'a>, event: &[u8]) -> ProgramResult {
    key_is(event_authority, &pda(&[EVENT_SEED, &[c.event_bump]], program_id)?)?;
    key_is(program, program_id)?;
    let mut data = Vec::with_capacity(event.len() + 1);
    data.push(255u8);
    data.extend_from_slice(event);
    let ix = Instruction { program_id: *program_id, accounts: vec![AccountMeta::new_readonly(*event_authority.key, true)], data };
    invoke_signed(&ix, &[event_authority.clone(), program.clone()], &[&[EVENT_SEED, &[c.event_bump]]])
}

fn trade_event(trader: &Pubkey, account: &Pubkey, is_buy: bool, amount: u64, curve: u64, cut: u64, fee: u64, supply: u64) -> Vec<u8> {
    let mut e = Vec::with_capacity(106);
    e.push(1u8);
    e.extend_from_slice(trader.as_ref());
    e.extend_from_slice(account.as_ref());
    e.push(is_buy as u8);
    for v in [amount, curve, cut, fee, supply] {
        e.extend_from_slice(&v.to_le_bytes());
    }
    e
}

fn pair_event(tag: u8, a: &Pubkey, b: &Pubkey, amount: u64) -> Vec<u8> {
    let mut e = Vec::with_capacity(73);
    e.push(tag);
    e.extend_from_slice(a.as_ref());
    e.extend_from_slice(b.as_ref());
    e.extend_from_slice(&amount.to_le_bytes());
    e
}

// ---------------------------------------------------------------- instructions

fn accounts<'a, 'b, const N: usize>(a: &'b [AccountInfo<'a>]) -> Result<&'b [AccountInfo<'a>; N], ProgramError> {
    a.get(..N).and_then(|s| s.try_into().ok()).ok_or(ProgramError::NotEnoughAccountKeys)
}

fn arg_u64(d: &[u8], at: usize) -> Result<u64, ProgramError> {
    d.get(at..at + 8).map(|b| u64::from_le_bytes(b.try_into().unwrap())).ok_or(ProgramError::InvalidInstructionData)
}
fn arg_u16(d: &[u8], at: usize) -> Result<u16, ProgramError> {
    d.get(at..at + 2).map(|b| u16::from_le_bytes(b.try_into().unwrap())).ok_or(ProgramError::InvalidInstructionData)
}

pub fn process_instruction(program_id: &Pubkey, accs: &[AccountInfo], data: &[u8]) -> ProgramResult {
    let (&tag, args) = data.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => initialize(program_id, accs, args),
        1 => list(program_id, accs, arg_u64(args, 0)?),
        2 => buy(program_id, accs, arg_u64(args, 0)?, arg_u64(args, 8)?),
        3 => sell(program_id, accs, arg_u64(args, 0)?, arg_u64(args, 8)?),
        4 => deposit_fees(program_id, accs, arg_u64(args, 0)?),
        5 => claim(program_id, accs),
        6 => admin(program_id, accs, args),
        7 => close_holder(program_id, accs),
        255 => {
            // an event: only this program, signing as the event authority, can produce one
            let ea = accs.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
            signer(ea)?;
            key_is(ea, &Pubkey::find_program_address(&[EVENT_SEED], program_id).0)
        }
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

/// 0: create the config and the USDC vault. args: min starting price, slope, trader cut bps, protocol fee bps
/// accounts: admin (signer, payer), config, vault, usdc_mint, treasury_usdc, system_program, token_program
fn initialize(program_id: &Pubkey, accs: &[AccountInfo], args: &[u8]) -> ProgramResult {
    let [admin, config, vault, mint, treasury, system, token_program] = accounts::<7>(accs)?;
    signer(admin)?;
    programs_check(token_program)?;
    let min_base_price = arg_u64(args, 0)?;
    let slope = arg_u64(args, 8)?;
    let trader_cut_bps = arg_u16(args, 16)?;
    let protocol_fee_bps = arg_u16(args, 18)?;
    if min_base_price == 0 || min_base_price > MAX_BASE_PRICE || trader_cut_bps as u128 >= BPS || protocol_fee_bps > MAX_PROTOCOL_FEE_BPS {
        return Err(err(KeysError::BadConfig));
    }
    // the trader's cut of any curve range must be exact, so the reserve always equals the sum of what each
    // outstanding key put in and every seller is refunded exactly that, in any order and any chunk size. the
    // slope is checked here; each trader's starting price is checked when they list
    if (slope as u128 * trader_cut_bps as u128) % BPS != 0 {
        return Err(err(KeysError::BadConfig));
    }
    if mint.owner != &TOKEN_PROGRAM_ID || mint.data_len() != MINT_LEN {
        return Err(err(KeysError::BadAccount));
    }
    let (treasury_mint, _) = token_account(treasury)?;
    if &treasury_mint != mint.key {
        return Err(err(KeysError::BadAccount));
    }
    if config.data_len() != 0 || config.owner == program_id {
        return Err(err(KeysError::AlreadyInitialized));
    }
    let (config_key, bump) = Pubkey::find_program_address(&[CONFIG_SEED], program_id);
    let (vault_key, vault_bump) = Pubkey::find_program_address(&[VAULT_SEED], program_id);
    let (_, event_bump) = Pubkey::find_program_address(&[EVENT_SEED], program_id);
    key_is(config, &config_key)?;
    key_is(vault, &vault_key)?;

    create_pda(admin, config, system, &[CONFIG_SEED, &[bump]], CONFIG_LEN, program_id)?;
    create_pda(admin, vault, system, &[VAULT_SEED, &[vault_bump]], TOKEN_ACCOUNT_LEN, &TOKEN_PROGRAM_ID)?;
    // InitializeAccount3: the vault holds USDC and only the config PDA can move it
    let mut data = vec![18u8];
    data.extend_from_slice(config_key.as_ref());
    let ix = Instruction { program_id: TOKEN_PROGRAM_ID, accounts: vec![AccountMeta::new(vault_key, false), AccountMeta::new_readonly(*mint.key, false)], data };
    invoke(&ix, &[vault.clone(), mint.clone(), token_program.clone()])?;

    let c = Config { admin: *admin.key, treasury_usdc: *treasury.key, usdc_mint: *mint.key, min_base_price, slope, trader_cut_bps, protocol_fee_bps, buys_paused: false, bump, vault_bump, event_bump };
    c.write(&mut config.try_borrow_mut_data()?);
    Ok(())
}

/// 1: a trader opts in, at a starting price of their choosing. only the trader's own wallet can list it
/// accounts: trader (signer, payer), config, trader_state, system_program, event_authority, program
fn list(program_id: &Pubkey, accs: &[AccountInfo], base_price: u64) -> ProgramResult {
    let [trader, config, state, system, ea, program] = accounts::<6>(accs)?;
    signer(trader)?;
    let c = load_config(program_id, config)?;
    // within bounds, and exact under the trader cut (see initialize)
    if base_price < c.min_base_price || base_price > MAX_BASE_PRICE || (base_price as u128 * c.trader_cut_bps as u128) % BPS != 0 {
        return Err(err(KeysError::BadPrice));
    }
    if state.owner == program_id && state.data_len() != 0 {
        return Err(err(KeysError::AlreadyListed));
    }
    let (key, bump) = Pubkey::find_program_address(&[TRADER_SEED, trader.key.as_ref()], program_id);
    key_is(state, &key)?;
    create_pda(trader, state, system, &[TRADER_SEED, trader.key.as_ref(), &[bump]], TRADER_LEN, program_id)?;
    Trader { trader: *trader.key, supply: 0, reserve: 0, acc_per_key: 0, bump, base_price }.write(&mut state.try_borrow_mut_data()?);
    let mut e = vec![0u8];
    e.extend_from_slice(trader.key.as_ref());
    e.extend_from_slice(&base_price.to_le_bytes());
    emit(program_id, &c, ea, program, &e)
}

/// 2: buy `amount` keys for at most `max_total` USDC (curve price plus fee)
/// accounts: buyer (signer, payer), config, trader_state, holder_state, buyer_usdc, trader_usdc, treasury_usdc,
/// vault, token_program, system_program, event_authority, program
fn buy(program_id: &Pubkey, accs: &[AccountInfo], amount: u64, max_total: u64) -> ProgramResult {
    let [buyer, config, state, holder_state, buyer_usdc, trader_usdc, treasury, vault, token_program, system, ea, program] = accounts::<12>(accs)?;
    signer(buyer)?;
    programs_check(token_program)?;
    let c = load_config(program_id, config)?;
    if c.buys_paused {
        return Err(err(KeysError::Paused));
    }
    let mut t = load_trader(program_id, state)?;
    if amount == 0 {
        return Err(err(KeysError::ZeroAmount));
    }
    let after = t.supply.checked_add(amount).ok_or(err(KeysError::Math))?;
    if after > SUPPLY_CAP {
        return Err(err(KeysError::SupplyCap));
    }
    let curve = c.curve_cost(t.base_price, t.supply, amount)?;
    let cut = c.trader_cut_of(curve);
    let fee = c.fee_of(curve);
    let total = curve.checked_add(fee).ok_or(err(KeysError::Math))?;
    if total > max_total {
        return Err(err(KeysError::Slippage));
    }
    // the cut goes to the trader's own USDC account and nowhere else
    if usdc_account(trader_usdc, &c)? != t.trader {
        return Err(err(KeysError::BadAccount));
    }
    key_is(treasury, &c.treasury_usdc)?;
    vault_check(program_id, vault, &c)?;

    let mut h = match load_holder(program_id, holder_state, &t.trader, buyer.key)? {
        Some(h) => h,
        None => {
            let (_, bump) = Pubkey::find_program_address(&[HOLDER_SEED, t.trader.as_ref(), buyer.key.as_ref()], program_id);
            create_pda(buyer, holder_state, system, &[HOLDER_SEED, t.trader.as_ref(), buyer.key.as_ref(), &[bump]], HOLDER_LEN, program_id)?;
            Holder { trader: t.trader, holder: *buyer.key, balance: 0, reward_debt: 0, owed: 0, bump }
        }
    };
    h.settle(t.acc_per_key)?;
    t.supply = after;
    t.reserve = t.reserve.checked_add(curve - cut).ok_or(err(KeysError::Math))?;
    h.balance = h.balance.checked_add(amount).ok_or(err(KeysError::Math))?;
    h.checkpoint(t.acc_per_key)?;
    t.write(&mut state.try_borrow_mut_data()?);
    h.write(&mut holder_state.try_borrow_mut_data()?);

    token_transfer(token_program, buyer_usdc, vault, buyer, curve - cut, None)?;
    token_transfer(token_program, buyer_usdc, trader_usdc, buyer, cut, None)?;
    token_transfer(token_program, buyer_usdc, treasury, buyer, fee, None)?;
    emit(program_id, &c, ea, program, &trade_event(&t.trader, buyer.key, true, amount, curve, cut, fee, t.supply))
}

/// 3: sell `amount` keys back to the reserve for at least `min_net` USDC
/// accounts: seller (signer), config, trader_state, holder_state, seller_usdc, treasury_usdc, vault,
/// token_program, event_authority, program
fn sell(program_id: &Pubkey, accs: &[AccountInfo], amount: u64, min_net: u64) -> ProgramResult {
    let [seller, config, state, holder_state, seller_usdc, treasury, vault, token_program, ea, program] = accounts::<10>(accs)?;
    signer(seller)?;
    programs_check(token_program)?;
    let c = load_config(program_id, config)?;
    let mut t = load_trader(program_id, state)?;
    if amount == 0 {
        return Err(err(KeysError::ZeroAmount));
    }
    let mut h = load_holder(program_id, holder_state, &t.trader, seller.key)?.ok_or(err(KeysError::Insufficient))?;
    if h.balance < amount || t.supply < amount {
        return Err(err(KeysError::Insufficient));
    }
    usdc_account(seller_usdc, &c)?;
    key_is(treasury, &c.treasury_usdc)?;
    vault_check(program_id, vault, &c)?;

    let curve = c.curve_cost(t.base_price, t.supply - amount, amount)?;
    let refund = curve - c.trader_cut_of(curve);
    let fee = c.fee_of(refund);
    let net = refund - fee;
    if net < min_net {
        return Err(err(KeysError::Slippage));
    }
    h.settle(t.acc_per_key)?;
    t.supply -= amount;
    t.reserve = t.reserve.checked_sub(refund).ok_or(err(KeysError::Math))?;
    h.balance -= amount;
    h.checkpoint(t.acc_per_key)?;
    t.write(&mut state.try_borrow_mut_data()?);
    h.write(&mut holder_state.try_borrow_mut_data()?);

    let seeds: &[&[u8]] = &[CONFIG_SEED, &[c.bump]];
    token_transfer(token_program, vault, seller_usdc, config, net, Some(seeds))?;
    token_transfer(token_program, vault, treasury, config, fee, Some(seeds))?;
    emit(program_id, &c, ea, program, &trade_event(&t.trader, seller.key, false, amount, refund, 0, fee, t.supply))
}

/// 4: split `amount` USDC across the trader's current holders, pro rata to keys held
/// accounts: depositor (signer), config, trader_state, depositor_usdc, vault, token_program, event_authority, program
fn deposit_fees(program_id: &Pubkey, accs: &[AccountInfo], amount: u64) -> ProgramResult {
    let [depositor, config, state, from, vault, token_program, ea, program] = accounts::<8>(accs)?;
    signer(depositor)?;
    programs_check(token_program)?;
    let c = load_config(program_id, config)?;
    let mut t = load_trader(program_id, state)?;
    if amount == 0 {
        return Err(err(KeysError::ZeroAmount));
    }
    if t.supply == 0 {
        return Err(err(KeysError::NoHolders));
    }
    vault_check(program_id, vault, &c)?;
    let add = (amount as u128).checked_mul(ACC).ok_or(err(KeysError::Math))? / t.supply as u128;
    t.acc_per_key = t.acc_per_key.checked_add(add).ok_or(err(KeysError::Math))?;
    t.write(&mut state.try_borrow_mut_data()?);
    token_transfer(token_program, from, vault, depositor, amount, None)?;
    emit(program_id, &c, ea, program, &pair_event(2, &t.trader, depositor.key, amount))
}

/// 5: pay out the holder's fee share from one trader
/// accounts: holder (signer), config, trader_state, holder_state, holder_usdc, vault, token_program, event_authority, program
fn claim(program_id: &Pubkey, accs: &[AccountInfo]) -> ProgramResult {
    let [holder, config, state, holder_state, holder_usdc, vault, token_program, ea, program] = accounts::<9>(accs)?;
    signer(holder)?;
    programs_check(token_program)?;
    let c = load_config(program_id, config)?;
    let t = load_trader(program_id, state)?;
    let mut h = load_holder(program_id, holder_state, &t.trader, holder.key)?.ok_or(err(KeysError::Insufficient))?;
    usdc_account(holder_usdc, &c)?;
    vault_check(program_id, vault, &c)?;
    h.settle(t.acc_per_key)?;
    h.checkpoint(t.acc_per_key)?;
    let amount = h.owed;
    h.owed = 0;
    h.write(&mut holder_state.try_borrow_mut_data()?);
    if amount == 0 {
        return Ok(());
    }
    token_transfer(token_program, vault, holder_usdc, config, amount, Some(&[CONFIG_SEED, &[c.bump]]))?;
    emit(program_id, &c, ea, program, &pair_event(3, &t.trader, holder.key, amount))
}

/// 6: admin settings. op 0 set treasury (account 2), 1 protocol fee, 2 pause buys, 3 hand over admin
/// accounts: admin (signer), config, [new treasury_usdc]
fn admin(program_id: &Pubkey, accs: &[AccountInfo], args: &[u8]) -> ProgramResult {
    let [admin, config] = accounts::<2>(accs)?;
    signer(admin)?;
    let mut c = load_config(program_id, config)?;
    if admin.key != &c.admin {
        return Err(err(KeysError::NotAdmin));
    }
    let (&op, rest) = args.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match op {
        0 => {
            let treasury = accs.get(2).ok_or(ProgramError::NotEnoughAccountKeys)?;
            usdc_account(treasury, &c)?;
            c.treasury_usdc = *treasury.key;
        }
        1 => {
            let bps = arg_u16(rest, 0)?;
            if bps > MAX_PROTOCOL_FEE_BPS {
                return Err(err(KeysError::BadConfig));
            }
            c.protocol_fee_bps = bps;
        }
        2 => c.buys_paused = *rest.first().ok_or(ProgramError::InvalidInstructionData)? != 0,
        3 => {
            let next = rest.get(..32).ok_or(ProgramError::InvalidInstructionData)?;
            c.admin = Pubkey::new_from_array(next.try_into().unwrap());
            if c.admin == Pubkey::default() {
                return Err(err(KeysError::BadConfig));
            }
        }
        _ => return Err(ProgramError::InvalidInstructionData),
    }
    c.write(&mut config.try_borrow_mut_data()?);
    Ok(())
}

/// 7: close an empty holder record (no keys, nothing to claim) and return its rent to the holder
/// accounts: holder (signer, writable), trader_state, holder_state
fn close_holder(program_id: &Pubkey, accs: &[AccountInfo]) -> ProgramResult {
    let [holder, state, holder_state] = accounts::<3>(accs)?;
    signer(holder)?;
    let t = load_trader(program_id, state)?;
    let mut h = load_holder(program_id, holder_state, &t.trader, holder.key)?.ok_or(err(KeysError::BadAccount))?;
    h.settle(t.acc_per_key)?;
    if h.balance != 0 || h.owed != 0 {
        return Err(err(KeysError::NotEmpty));
    }
    let lamports = holder_state.lamports();
    **holder_state.try_borrow_mut_lamports()? = 0;
    **holder.try_borrow_mut_lamports()? = holder.lamports().checked_add(lamports).ok_or(err(KeysError::Math))?;
    holder_state.resize(0)?;
    holder_state.assign(&system_program::ID);
    Ok(())
}
