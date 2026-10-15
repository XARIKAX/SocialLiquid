# socialLiquid

the social layer for hyperliquid. follow the best traders, see every position as it opens, and trade alongside them. traders post a thesis, open the position on hyperliquid through our frontend, and everyone watches the live position, the pnl, and whether they held or dumped.

we do not run an exchange. every order routes to hyperliquid with our builder code and we earn a builder fee on each fill. the product is the frontend, the social layer, and the indexer.

## stack

| layer | choice |
| --- | --- |
| frontend | next.js 15 (app router), typescript, tailwind v4 |
| wallet | wagmi + viem, lean connect modal (injected, walletconnect, coinbase) |
| exchange | hyperliquid via `@nktkas/hyperliquid`, builder codes |
| backend | next.js route handlers + postgres + prisma |
| indexer | node worker polling the info api, budget bound, plus websocket fills for our own users |
| charts | tradingview lightweight-charts fed from `candleSnapshot` |

## run it

```bash
pnpm install
cp .env.example .env            # fill in AGENT_KEY_SECRET and SESSION_SECRET (openssl rand -hex 32)
pnpm db:push                    # creates the schema in DATABASE_URL (pnpm start also does this)
pnpm dev                        # app on :3000
pnpm worker                     # indexer, in a second terminal
```

the app talks to hyperliquid mainnet. `NEXT_PUBLIC_HL_NETWORK=testnet` points it at testnet for local development (the old `NEXT_PUBLIC_HL_TESTNET` flag is ignored). `HL_MOCK=true` swaps in a synthetic in-process exchange (deterministic prices, a dozen synthetic traders, a mock write side) so the whole stack runs with no network at all. never set `HL_MOCK` in production.

## deploying

`pnpm start` runs `prisma db push` before `next start`, so a fresh database gets its schema on first boot. `GET /api/health` reports whether the database, the schema and the hyperliquid api are reachable, which required env vars are missing, and whether the builder address is configured and holds the 100 USDC hyperliquid requires before users can approve its fee.

railway, three services from this repo: **web** (uses `railway.json`: `pnpm start`, health check on `/api/health`), **worker** (set *Settings → Config-as-code → path* to `railway.worker.json`, or type `pnpm worker` as the start command), and **postgres**. both app services get the same variables; `DATABASE_URL=${{Postgres.DATABASE_URL}}` on both. `NEXT_PUBLIC_*` values are baked in at build time, so changing one needs a redeploy of the web service.

## env

| var | purpose |
| --- | --- |
| `DATABASE_URL` | postgres |
| `BUILDER_ADDRESS` / `NEXT_PUBLIC_BUILDER_ADDRESS` | builder wallet. needs 100 usdc perps account value on mainnet or orders with our code are rejected |
| `BUILDER_FEE_TENTHS_BP` | `50` = 0.05% per side. hard capped at 100 (0.1%) |
| `AGENT_KEY_SECRET` | 32 byte hex. aes-256-gcm for agent private keys at rest |
| `SESSION_SECRET` | signs the session cookie |
| `INVITE_CODE` | mainnet gate. empty = open. testnet is always open |
| `NEXT_PUBLIC_HL_NETWORK` | `mainnet` (default) or `testnet` |
| `HL_LEADERBOARD_SOURCE` | empty = hyperliquid leaderboard feed, `portfolio` = rebuild from the portfolio api for the featured traders |
| `NEXT_PUBLIC_WALLETCONNECT_ID` | optional. without it the walletconnect option is hidden |
| `HL_WEIGHT_BUDGET_PER_MIN` | info api weight budget for the worker (published limit 1200 / min / ip) |
| `POLL_INTERVAL_MS` | floor on the per address poll interval |
| `SEED_ADDRESSES` / `SEED_COUNT` | leaderboard seed fallback and size |
| `PINNED_ADDRESSES` | extra always-tracked traders, on top of the hand-verified list in `src/lib/featured.ts` |
| `HL_LEADERBOARD_TOP_N` / `HL_LEADERBOARD_REFRESH_MS` | how many hyperliquid leaderboard rows to mirror (10) and how often (1h) |
| `HL_MOCK` | offline synthetic exchange |
| `NEXT_PUBLIC_KEYS_LIVE` | `true` turns /keys from the sample-data preview into the real thing: creators, paid subscriptions, keys |
| `NEXT_PUBLIC_SUBS_TREASURY` | hyperliquid address for the platform's 10% of subscriptions. empty = creators keep 100% |
| `NEXT_PUBLIC_KEYS_PROGRAM_ID` / `NEXT_PUBLIC_KEYS_LOOKUP_TABLE` | the keys program on Solana and its lookup table (`npm run init` prints both). empty = keys show as opening soon |
| `NEXT_PUBLIC_KEYS_USDC_MINT` | the USDC mint keys trade in. empty = mainnet USDC |
| `NEXT_PUBLIC_SOLANA_RPC` / `NEXT_PUBLIC_SOLANA_CLUSTER` / `SOLANA_RPC` | Solana rpc for the browser and for the worker, and which cluster wallets sign for |
| `NEXT_PUBLIC_JUPITER_API` | Jupiter swap api for paying with SOL. empty = the public lite api |
| `KEYS_DISTRIBUTOR_KEY` / `BUILDER_PRIVATE_KEY` | payout script only: the Solana wallet that deposits holder fees, and the builder wallet that pays traders |

## keys

`/keys` is where traders get paid. everything about the money lives in `src/lib/keys.ts`.

- **subscriptions.** each trader sets one monthly price, free to $500, in the studio. subscribing sends USDC on hyperliquid straight to the trader (and 10% to `NEXT_PUBLIC_SUBS_TREASURY` when set): `usdSend` from perps, or `spotSend` for unified accounts. the server quotes the transfers (`POST /api/keys/subscribe`), then finds them in the subscriber's ledger (`userNonFundingLedgerUpdates`) inside the quote's 20 minute window and grants 30 days (`/subscribe/confirm`). a transfer hash pays for one month, once. nothing is custodied and nothing auto-debits: the worker sends a renewal alert three days before a month runs out. subscriber posts are gated on the server; a locked post leaves without its text.
- **keys.** `programs/keys`, a Solana program. a linear curve per trader ($5 + $0.25 per key in supply, 2000 cap), priced in USDC. on every buy 10% of the curve price goes to the trader's USDC account and 90% stays in the program's vault as that trader's reserve, so every key can always be sold back for what it put in; 2% protocol fee each way. buyers pay in USDC, or in SOL: a Jupiter swap goes in the same transaction as the buy, so both land or neither does. keys belong to a Solana wallet the user links to their account once, by signing a message with it. the worker indexes the program's events (self-CPIs, read from inner instructions, so log truncation never loses one) into `KeyTrade` / `KeyClaim`, which is where prices, holders and cost basis come from.
- **fee share.** builder fees on positions opened with "Take this trade" (`?copy=`) are credited to the copied trader by day (`KeyFeeAccrual`): 40% to their key holders, 30% to the trader, 30% kept. `pnpm keys:distribute` (dry run by default, `--execute` to send) deposits the holder share into the program from a Solana wallet, where holders claim it pro rata, and pays traders with `usdSend` on Hyperliquid. the builder earns on Hyperliquid, so the holder share has to be withdrawn and bridged to that Solana wallet first (Circle's CCTP); the dry run says how much.
- **program.** needs the Solana toolchain (`cargo-build-sbf`). `cd programs/keys && npm install && npm test` builds it and runs the suite in an in-process Solana (LiteSVM): splits, slippage, exact refunds, pro-rata fees, a randomised model check of reserves and payouts, and account-substitution attacks. to ship: `solana program deploy target/deploy/socialliquid_keys.so`, then `npm run init` with `KEYS_PROGRAM_ID`, `KEYS_ADMIN_KEY` and `KEYS_TREASURY`. it is unaudited.

## how trading works

1. connect a wallet and sign a nonce. that is the session. it authorises nothing on chain.
2. claim a handle. optional x handle.
3. enable trading, once. the server mints an agent (api) wallet and stores the key encrypted. the user's main wallet signs `approveAgent` for it and `approveBuilderFee` (max 0.1%) for our builder address, both client side through the sdk. we check `extraAgents` and `maxBuilderFee` and skip anything already approved. the main key never leaves the wallet.
4. every order is signed server side with the agent key and carries `builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE_TENTHS_BP }`. market orders are ioc limits with a 3% slippage cap. tp / sl go in the same `normalTpsl` group.
5. after a fill the server syncs the address immediately so the thesis can be bound to the mirrored position id.

## the terminal

`/trade` and `/m/[coin]` are a full perps terminal on the hyperliquid api:

- market header: coin selector with search and watchlist, mark, oracle, 24h change, volume, open interest, funding with the hourly countdown
- chart: candles + volume, sma / ema / bollinger / vwap overlays, funding history tab, your entry and liquidation lines, open orders drawn as price lines, thesis markers. tradingview-style chrome: hover nav (zoom in / out, pan, reset), range buttons 5y → 1d, go to date, live clock with utc offset, % / log / auto scales, snapshot to png, fullscreen. drawing rail with trend line, horizontal line and measure tools, lock, hide, clear, click to select and delete; drawings persist per coin in the browser
- light and dark themes, toggled in the top bar and remembered per browser. the landing page is always dark
- order book and recent trades, grouped by tick, sized in coin or usd, click a level to fill the ticket
- ticket: cross / isolated, leverage, market, limit (gtc / ioc / alo), stop market, stop limit, take profit market / limit, scale ladders, twap; size in coin or usd with a percent slider; reduce only; attached tp / sl with gain and loss %; liquidation price, order value, margin, book-walk slippage estimate, fees. every order carries the builder code
- bottom panel: traders and theses on the market, plus balances, positions (close, tp / sl on the position), open orders (cancel, cancel all), twap (terminate), trade history, funding history, order history, csv export

the server caches order book and trade reads for half a second so every viewer shares one upstream call.

## landing

the hero is the whole first screen: the school-of-fish image (`public/landing/hero.webp`, with a 960px cut for phones) under a top-to-bottom shade, copy top-left, the lead fish kept clear bottom-right. the still gets a slow drift, light rays and rising motes; all of it is transform-only so it costs nothing on the main thread. the backdrop is a video loop, `public/socialliquid-hero-loop.webm` (served first) with `socialliquid-hero-loop.mp4` as fallback: autoplay, muted, loop, playsinline, `object-fit: cover`, `object-position: right bottom` so the lead fish stays in frame on phones, and the still as poster so nothing flashes before the first frame. the loop was made from a 6s generated clip by crossfading its tail into its head (1.2s) and trimming to the blended region, so the seam is invisible. `prefers-reduced-motion` hides the video and shows the still. remove both files and the page falls back to the drifting still automatically. sections below fade and rise into view on scroll (`Reveal`), and the product shot uses real screenshots in `public/landing/terminal.webp` and `phone.webp`.

## profiles and following

connecting a wallet reads the address; signing the nonce claims it. a claimed account with no handle is forced through profile setup before anything else (name, @handle with live availability, bio, X and telegram usernames, avatar and banner). images are resized in the browser (avatar 320², banner 1500×500, jpeg) and stored as data urls on the user row, so there is no object storage to run. `/api/me/profile` saves it, the same dialog edits it later from the profile page. any hyperliquid address can be followed, claimed or not; profiles show mutuals, following and followers like fomo.

wallets: every extension that announces itself over eip-6963 gets its own row (metamask, phantom's evm account, rabby, and anything else installed), with install links for the big three when they are missing, plus walletconnect (needs `NEXT_PUBLIC_WALLETCONNECT_ID`, free at cloud.reown.com, covers phantom mobile, rainbow, trust, ledger and 400+ others) and coinbase wallet. hyperliquid accounts are evm addresses, so phantom connects with its ethereum account.

## alerts and replies

signed-in users get a bell in the top bar: the latest events from the traders they follow, an unread badge counted from `alertsSeenAt`, and mark-read on open (`/api/alerts`). while a page is open, new events from followed traders slide in as toasts bottom-right. every thesis has a reply thread (`ThesisReply`, 280 chars, claimed accounts only) under its card in the feed and on its share page; feed and profile payloads carry the reply count.

## copy trading

every open position on the feed and on a profile has a copy button. it opens `/m/[coin]?copy=<positionId>&from=<address>&side=&lev=` and the ticket prefills side and leverage (pushed to the exchange once trading is enabled), shows a "copying <trader>" chip and leaves the size to you. the order goes through the normal route with `copyOf`; after the fill the resulting position records `copiedFromAddress` / `copiedFromPositionId` (only when the source is someone else's position in the same coin). the feed shows "copied <trader>" on the copy and "n traders copied this" on the original.

## markets: perps, spot, tradfi

the market picker (⌘K) mirrors hyperliquid's: tabs for All · Perps · Spot · Tradfi · Trending · ★, search, sortable Last Price / 24h Change / 8h Funding / Volume / Open Interest columns, arrow keys and Enter. `HL.markets()` is the union of hyperliquid's main perps (`metaAndAssetCtxs`), its USDC spot pairs (`spotMetaAndAssetCtxs`, shown as SOL/USDC even though hyperliquid names Unit's token USOL) and every builder-deployed perp dex (`perpDexs` → `metaAndAssetCtxs({ dex })`), the HIP-3 "tradfi" markets like `xyz:BRENTOIL` grouped into Stocks · Indices · Commodities · FX · Pre-IPO by name. each row carries hyperliquid's id (`coin`: `BTC`, `@107`, `xyz:BRENTOIL`), a url slug (`/m/BTC`, `/m/spot:USOL`, `/m/xyz:BRENTOIL`) and the order asset id (perps index, `10000 + pair`, `100000 + dex × 10000 + index`). orders go through the same `placeOrder`; spot orders skip leverage and triggers and settle in the spot balances, builder-dex orders read their positions from `clearinghouseState({ dex })` (`/api/balance?dex=xyz`). the ticket switches to Buy / Sell with spot USDC and the held token on spot markets.

## chart indicators and account summary

the chart's ƒx menu is a searchable catalogue (`src/lib/indicators.ts`): overlays (SMA 9/20/50/100/200, EMA 9/21/50/200, WMA, Bollinger, VWAP, SuperTrend, Parabolic SAR, Donchian, Ichimoku) draw on the price pane, oscillators (RSI, MACD, Stochastic, Stochastic RSI, ATR, OBV, CCI, Williams %R, MFI) each get their own pane under the price with reference levels. the choice persists in localStorage. under the ticket, the account summary mirrors hyperliquid's: portfolio value (perps + spot), unrealized pnl, perps maintenance margin, margin ratio and account leverage, from `clearinghouseState` (`crossMaintenanceMarginUsed`, `totalNtlPos`). on a builder-dex market with no margin there, the ticket offers hyperliquid's unified margin (`userDexAbstraction`, one main-wallet signature) so the main account USDC backs trades on every builder dex.

## social layer

the parts that make the terminal read as a social app, on top of the feed, theses, follows and copy:

- **trader pins on the chart.** avatars at the entry price and time of every open position on this market by the traders you follow, plus the biggest books (`People` toggle, remembered). hover or tap opens a card with the trade, live pnl, the thesis and a Copy button that prefills the ticket. `src/components/market/trader-pins.tsx`; the chart hands it a `(time, price) → pixels` projector that interpolates between whole bars, because lightweight-charts answers fractional logical indexes with 0.
- **social strip** under the market header: who you follow is in this market, long/short split and net, avatar stack, how often the market was copied today (`copies24h` from `/api/market/[coin]`, which also flags each position with `followed`).
- **reactions and comments on every trade.** fire / skull / eyes on any feed card (`Reaction`, `POST /api/react`), comment threads under trade cards (`EventReply`, `/api/feed/[id]/replies`) reusing the thesis thread. feed items carry per-emoji counts, the viewer's own, and the comment count.
- **social notifications** in the bell (`Notification`): someone copied your trade, commented or reacted on your trade or thesis, your thesis settled. never for yourself, never twice per actor and thing. `/api/alerts` returns them next to followed-trader events with one unread count; toasts cover both.
- **copier stats**: `traderStats` counts distinct copiers, copied positions and what the copies made; the profile header shows "Copied by N traders · copiers +$X".
- **leaderboard**: a mirror of hyperliquid's own board for every window (24h, 7d, 30d, all time). the worker stores the top `HL_LEADERBOARD_TOP_N` (default 100) eligible, non-vault accounts of each window with all four windows' pnl / roi / volume (`HlLeaderboardEntry`), so switching windows ranks real leaders rather than re-sorting the 30d top. `/api/leaderboard/hl?window=&sort=pnl|roi|vlm|accountValue&q=&claimed=1` sorts, searches, filters to claimed socialLiquid accounts and reports followers and whether the viewer follows each row; the page has sortable columns, search, an "On socialLiquid" toggle and Follow buttons in place, the side widget a window picker.
- **trending by social signal**: `/api/trending` ranks markets by what traders do rather than volume: opens in the last hour and day, copies and theses in the last 24 h (30 s cache), plus "your people are in" for the viewer's follows. four cards on the markets page (`TrendingCards`) and a chip strip on the side Tokens tab (`TrendingStrip`), `src/components/market/trending.tsx`.
- **holder lists on spot markets**: the indexer mirrors every tracked address's spot balances into `SpotHolding` every 10 minutes (`src/lib/spot-holdings.ts`, and right away after one of our users trades spot). `/api/market/[coin]` returns `holders` for spot markets only; the bottom panel grows a Holders tab with handle, amount, usd value, follow state and age.
- **profile customisation**: a trading-style tag (`src/lib/styles.ts`, shown as a pill on the profile and feed cards), a pinned thesis (replaces "most liked") and a pinned trade (open or closed, with its thesis) chosen in the profile editor. `POST /api/me/profile` accepts `style`, `pinnedThesisId`, `pinnedPositionId` and only lets you pin your own.
- **points, streaks and badges**: a ledger (`PointEvent`, one row per user × kind × thing so the indexer can re-see events without double counting) scores closed trades (+10, +15 more in profit), theses (+5, +25 when they settle in profit), copies (+20 to the trader, +5 to the copier) and invites (+50 / +25). `src/lib/points.ts`; the worker backfills on start. win streaks and best streak come from closed positions and are mirrored onto the user row (`winStreak`) so feed cards can show 🔥 for free; badges are derived from stats, never stored. profiles show points, rank, streak and badges; the leaderboard has a Points tab (all time / this week) with a "how points work" key; `/api/leaderboard/points?window=all|7d`.
- **invites with rewards**: every claimed account has a personal code (`User.inviteCode`, minted on the first visit to `/invite`) and link `/i/<code>` with its own share image. landing on the link stores a referral cookie (and opens the invite gate on a gated mainnet, so personal codes replace handing out the env code); the wallet's first sign-in is attributed to the inviter (`invitedById`), scores the newcomer +25, and the inviter gets +50 when the newcomer's first order fills. `/invite` shows the link, X / Telegram share, who came in and what it earned; profiles show "invited by" and "brought in N". `src/lib/invites.ts`.
- **groups**: a circle of traders with a shared feed and a members-only leaderboard, no chat (`Group`, `GroupMember`). create at `/groups`; private groups are joined through an invite link carrying the join code (`/groups/<slug>?join=CODE`, rotatable by the owner), public ones are listed and open. the group feed is the global `feed()` narrowed to member addresses with the same size / thesis filters; the group board ranks members by 7d / 30d pnl, win rate, points or streak with no minimum trade count. an owner who leaves hands the group to the longest-standing member, or it is deleted when empty. `src/lib/groups.ts`, `/api/groups/*`.
- **watching count**: `/api/presence` heartbeats (in-memory, per web instance, 45 s TTL) feed a "Watching" stat in the market header.

## bottom panel

the Positions tab has a Thesis column: a position opened without one (or one that deserves a second) gets a composer right there (`POST /api/thesis` binds it to the open position; `GET /api/thesis` lists your live ones), and it lands in the feed and the market's Thesis tab like one posted with the order.

the tabs under the chart carry live counts (Balances, Positions, Open Orders, TWAP, Chase) and the history tabs have hyperliquid's Type / Side / Market filters next to the "Only this market" toggle.

## chase orders

hyperliquid's "Chase" is in the ticket's Pro menu: a post-only limit that sits at the best bid (buys) or best ask (sells) and follows it. `src/lib/chase.ts` runs the loop in the browser every 2.5 s: read the book, cancel and re-place the ALO limit when the best price moved, step one level deeper after a post-only reject, stop at the time limit. the orders are ordinary hyperliquid limits through the agent, so a closed tab just leaves the last one resting. the Chase tab under the chart lists them with remaining size, resting price, re-price count and a Stop button; state persists in localStorage.

## deposits and withdrawals

both happen inside the app and never touch socialLiquid. the deposit modal mirrors hyperliquid's own dialog: pick an asset, then (for USDC) a deposit chain. every route is signed by the user's own wallet and credits the user's own hyperliquid account; `HL_MOCK` credits a synthetic ledger through `/api/mock/funds` instead.

| route | what happens | fee · time |
| --- | --- | --- |
| **Arbitrum** (default) | Circle CCTP V2: `TokenMessengerV2.depositForBurnWithHook` burns the USDC with Circle's `CctpForwarder` on HyperEVM as mint recipient and a 56-byte hook naming the user's account and the perps dex. Circle attests and forwards straight into the perps balance. | 0.2 USDC (Circle's forwarding fee, the same one hyperliquid quotes) · seconds with fast transfer (+ a few bps, from Circle's fee api), ~15 min standard |
| **Arbitrum (Legacy Bridge)** | plain USDC transfer to hyperliquid's Bridge2 | free · ~1 min · min 5 USDC (less is kept by the bridge) |
| **Arbitrum (Swap USDT for USDC)** | Uniswap v3 `exactInputSingle` USDT→USDC in the user's wallet (quoted through QuoterV2, 0.5% max slippage, 0.01% / 0.05% pools), then the Arbitrum CCTP route with what was received | 0.2 USDC + pool fee · seconds |
| **HyperEVM** | approve + `CoreDepositWallet.deposit(amount, 0)`: Circle's contract moves USDC from HyperEVM into HyperCore perps | free · seconds |
| **Ethereum · Base · Optimism · Polygon · Avalanche** | the same CCTP route from the other chains Circle forwards into HyperCore | 0.2 USDC · seconds / ~15 min |
| **BTC · ETH · SOL** | Unit (hyperunit.xyz), the rails hyperliquid's own dialog uses. the browser asks Unit's guardians for the user's deposit address on the native chain (our `/api/funds/unit` is the fallback, since Unit's edge sometimes refuses server-side calls); the answer is only shown with ≥2 guardian signatures and a well-formed address, with a QR and the same red minimum warning as hyperliquid: 0.0003 BTC / 0.007 ETH / 0.12 SOL, below is lost. lands in the hyperliquid **spot** balance (USOL / UBTC / UETH), which `/api/balance` now returns as `spot` and the modal watches live, marking the arrival. | Unit's network fee (≈$1.30 on Solana) |
| **AVAX, XPL, ZEC, MON, BONK, FARTCOIN, PUMP, SPX, 2Z, ANSEM, VIRTUAL** | listed, but no address in-app until their Unit minimums are verified (a deposit under the minimum is lost): the modal links to Unit's dialog for them. add `min` to the asset in `src/lib/unit.ts` to enable one. | |

**sell for USDC.** a spot coin from Unit becomes perps margin the way the hyperliquid app does it: a spot market sell on the coin's USDC pair, then `usdClassTransfer` from spot to perps. the sell is an order, and hyperliquid orders are L1 actions signed under a fixed `chainId: 1337` domain that browser wallets refuse (Phantom "Unsupported network", MetaMask chain mismatch), so it is placed by the approved agent through `/api/trade/spot-sell`, exactly like hyperliquid's own frontend; the transfer is a user-signed message from the main wallet on whatever network the wallet is on. the modal shows the enable-trading step inline when the agent is not approved yet, and enabling works for a spot-only account (no USDC needed first; USDC sitting in spot is moved to perps on the way).

addresses and the hook layout live in `src/lib/funds.ts`; `NEXT_PUBLIC_CCTP_FORWARD_FEE` overrides the forwarding fee if Circle changes it, `UNIT_API_URL` / `NEXT_PUBLIC_UNIT_API_URL` the Unit endpoint for the server and the browser. `/api/health` reports whether the server can reach Unit.

withdrawals mirror hyperliquid's withdrawal dialog the same way. every action is signed by the main wallet, never by the agent key:

| route | what happens | fee · time |
| --- | --- | --- |
| **Arbitrum** (default) | hyperliquid's `sendToEvmWithData`: hyperliquid burns the USDC through Circle CCTP and Circle mints it to the destination on Arbitrum (CCTP domain 3) | 0.2 USDC (Circle) · within 5 minutes |
| **Arbitrum (Legacy Bridge)** | `withdraw3`, the original validator-processed withdrawal | 1 USDC (hyperliquid) · ~5 minutes |
| **HyperEVM** | `usdClassTransfer` perps→spot, then `spotSend` of USDC to its system address `0x2000…0000`, which lands as USDC at the same address on HyperEVM | free · seconds |
| **Ethereum · Base · Optimism · Polygon · Avalanche** | `sendToEvmWithData` with that chain's CCTP domain | 1.2 USDC to Ethereum, 0.2 elsewhere · within 5 minutes |
| **BTC · ETH · SOL** | Unit: `/gen/hyperliquid/<chain>/<asset>/<destination>` names the hyperliquid address for that destination (browser first, server fallback, ≥2 guardian signatures, must be a 0x address), then a `spotSend` of UBTC / UETH / USOL to it (token ids from hyperliquid's `spotMeta` via `/api/funds/tokens`). destination is validated as an address on the native chain; minimums 0.002 BTC / 0.05 ETH / 0.2 SOL (the larger figures in Unit's docs, since below the floor is lost) | Unit's network fee · ~4 minutes |
| other Unit assets | link to Unit's dialog until their minimums are verified | |

## receipts

a thesis is bound to a position id at post time. when the worker sees that position close it sets the outcome from on-chain fills: `LIQUIDATED` if a liquidation fill closed it, `DUMPED` if it closed within 60 minutes of the thesis, otherwise `PROFIT` or `LOSS` from realised pnl. the outcome is on the feed card, the profile, and the share page.

## indexer

`worker/index.ts` polls every `TrackedAddress`. `clearinghouseState` is weight 2 and `userFills` is weight 20, so with 200 addresses a full pass at 1000 weight / min takes about 24 seconds, not 5. the worker is budget bound with a token bucket and only fetches fills when a position changed (or every 10 minutes). our own users are also subscribed to websocket `userFills`, capped at hyperliquid's 10 unique users per ip, so their trades show within a second.

on startup and every hour the worker mirrors hyperliquid's own leaderboard (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`, the feed behind app.hyperliquid.xyz/leaderboard) into `HlLeaderboardEntry`: the same 30-day window, the same exclusion rule (under 100k account value and under 10M volume), sorted by 30d pnl, top `HL_LEADERBOARD_TOP_N` (10). account value, pnl, roi and volume are stored exactly as hyperliquid reports them and shown on `/leaderboard` under the default "hyperliquid 30d" tab, so launch-day rankings match hyperliquid to the cent. the same ordering seeds the tracked address list, so those traders' positions are indexed first. if the worker is not running, the web process fetches the board itself on the first request and re-fetches in the background once it is older than the refresh interval. the feed is always mainnet. if it is unreachable, the board is rebuilt for the featured traders from the `portfolio` info endpoint (exact pnl and volume, roi against the window's starting account value) and labelled as such.

`src/lib/featured.ts` holds hand-verified traders (copied from hyperliquid's leaderboard) that are always tracked with source MANUAL, so they are polled before discovered addresses from the first cycle. `pnpm hl:top` prints that top 10 (full addresses, account value, pnl, roi, volume) from your own machine, plus a ready `SEED_ADDRESSES` line.

trader profiles read hyperliquid directly as well: the pnl card and the all-time / 30d / 7d / 24h figures come from the `portfolio` endpoint (hyperliquid's own cumulative pnl curve and volume), open positions from `clearinghouseState`, and fills straight from `userFills` until the indexer has walked the account. viewing a tracked or featured profile also triggers a background sync, so profiles fill in without the worker.

positions and fills are mirrored from chain and never written by the client. `lib/indexer.ts` is shared by the worker and the trade route.

**history on first sight.** the first time an address is synced, `src/lib/history.ts` pages the exchange's fill history (up to 2000 fills a call, the most recent 10000 at most), cuts it into positions by walking `startPosition` through opens, adds, trims, closes and flips, and inserts the ones closed before our own rows begin (`Position.reconstructed`), plus the fills. pnl per position is the sum of hyperliquid's own `closedPnl`, so it matches their numbers. an already-open position gets its real open time back. win rate, trade count and top trades therefore cover a trader's real history, not just the time we have watched them; `TrackedAddress.historySyncedAt` makes it run once.

## layout

`/` and `/m/[coin]`: feed on the left (feed / alerts / tokens / leaderboard tabs, filters for thesis only, following only, min size, market), chart and positions table in the centre, trade panel on the right. `/t/[handle]` works for any hyperliquid address, claimed or not. `/t/[handle]/thesis/[id]` is the share page with an og image and an x share button. `/leaderboard` opens on hyperliquid's own 30d top 10, then ranks our indexed traders by 7d pnl, win rate, thesis accuracy, followers, minimum 5 closed trades.

## not in the mvp

no custom contracts, no spot trading (native-asset deposits land in spot; selling them for USDC happens on hyperliquid), no comments, no mobile app. x handle is free text for now; oauth is a follow up.
