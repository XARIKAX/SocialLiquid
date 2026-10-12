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

## deposits and withdrawals

both happen inside the app and never touch socialLiquid. the deposit modal mirrors hyperliquid's own dialog: pick an asset, then (for USDC) a deposit chain. every route is signed by the user's own wallet and credits the user's own hyperliquid account; `HL_MOCK` credits a synthetic ledger through `/api/mock/funds` instead.

| route | what happens | fee · time |
| --- | --- | --- |
| **Arbitrum** (default) | Circle CCTP V2: `TokenMessengerV2.depositForBurnWithHook` burns the USDC with Circle's `CctpForwarder` on HyperEVM as mint recipient and a 56-byte hook naming the user's account and the perps dex. Circle attests and forwards straight into the perps balance. | 0.2 USDC (Circle's forwarding fee, the same one hyperliquid quotes) · seconds with fast transfer (+ a few bps, from Circle's fee api), ~15 min standard |
| **Arbitrum (Legacy Bridge)** | plain USDC transfer to hyperliquid's Bridge2 | free · ~1 min · min 5 USDC (less is kept by the bridge) |
| **Arbitrum (Swap USDT for USDC)** | Uniswap v3 `exactInputSingle` USDT→USDC in the user's wallet (quoted through QuoterV2, 0.5% max slippage, 0.01% / 0.05% pools), then the Arbitrum CCTP route with what was received | 0.2 USDC + pool fee · seconds |
| **HyperEVM** | approve + `CoreDepositWallet.deposit(amount, 0)`: Circle's contract moves USDC from HyperEVM into HyperCore perps | free · seconds |
| **Ethereum · Base · Optimism · Polygon · Avalanche** | the same CCTP route from the other chains Circle forwards into HyperCore | 0.2 USDC · seconds / ~15 min |
| **BTC, ETH, SOL, AVAX, XPL, ZEC, MON, BONK, FARTCOIN, PUMP, SPX, 2Z, ANSEM, VIRTUAL** | Unit (hyperunit.xyz): `/api/funds/unit` asks Unit's guardians for the user's deposit address on the native chain and shows it with minimum and confirmations. lands in the hyperliquid **spot** balance. | network gas only |

addresses and the hook layout live in `src/lib/funds.ts`; `NEXT_PUBLIC_CCTP_FORWARD_FEE` overrides the forwarding fee if Circle changes it, `UNIT_API_URL` the Unit endpoint. a withdrawal is hyperliquid's `withdraw3` action signed by the main wallet, never by the agent key ($1 fee, USDC on arbitrum in about five minutes).

## receipts

a thesis is bound to a position id at post time. when the worker sees that position close it sets the outcome from on-chain fills: `LIQUIDATED` if a liquidation fill closed it, `DUMPED` if it closed within 60 minutes of the thesis, otherwise `PROFIT` or `LOSS` from realised pnl. the outcome is on the feed card, the profile, and the share page.

## indexer

`worker/index.ts` polls every `TrackedAddress`. `clearinghouseState` is weight 2 and `userFills` is weight 20, so with 200 addresses a full pass at 1000 weight / min takes about 24 seconds, not 5. the worker is budget bound with a token bucket and only fetches fills when a position changed (or every 10 minutes). our own users are also subscribed to websocket `userFills`, capped at hyperliquid's 10 unique users per ip, so their trades show within a second.

on startup and every hour the worker mirrors hyperliquid's own leaderboard (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`, the feed behind app.hyperliquid.xyz/leaderboard) into `HlLeaderboardEntry`: the same 30-day window, the same exclusion rule (under 100k account value and under 10M volume), sorted by 30d pnl, top `HL_LEADERBOARD_TOP_N` (10). account value, pnl, roi and volume are stored exactly as hyperliquid reports them and shown on `/leaderboard` under the default "hyperliquid 30d" tab, so launch-day rankings match hyperliquid to the cent. the same ordering seeds the tracked address list, so those traders' positions are indexed first. if the worker is not running, the web process fetches the board itself on the first request and re-fetches in the background once it is older than the refresh interval. the feed is always mainnet. if it is unreachable, the board is rebuilt for the featured traders from the `portfolio` info endpoint (exact pnl and volume, roi against the window's starting account value) and labelled as such.

`src/lib/featured.ts` holds hand-verified traders (copied from hyperliquid's leaderboard) that are always tracked with source MANUAL, so they are polled before discovered addresses from the first cycle. `pnpm hl:top` prints that top 10 (full addresses, account value, pnl, roi, volume) from your own machine, plus a ready `SEED_ADDRESSES` line.

trader profiles read hyperliquid directly as well: the pnl card and the all-time / 30d / 7d / 24h figures come from the `portfolio` endpoint (hyperliquid's own cumulative pnl curve and volume), open positions from `clearinghouseState`, and fills straight from `userFills` until the indexer has walked the account. viewing a tracked or featured profile also triggers a background sync, so profiles fill in without the worker.

positions and fills are mirrored from chain and never written by the client. `lib/indexer.ts` is shared by the worker and the trade route.

## layout

`/` and `/m/[coin]`: feed on the left (feed / alerts / tokens / leaderboard tabs, filters for thesis only, following only, min size, market), chart and positions table in the centre, trade panel on the right. `/t/[handle]` works for any hyperliquid address, claimed or not. `/t/[handle]/thesis/[id]` is the share page with an og image and an x share button. `/leaderboard` opens on hyperliquid's own 30d top 10, then ranks our indexed traders by 7d pnl, win rate, thesis accuracy, followers, minimum 5 closed trades.

## not in the mvp

no custom contracts, no spot trading (native-asset deposits land in spot; selling them for USDC happens on hyperliquid), no comments, no mobile app. x handle is free text for now; oauth is a follow up.
