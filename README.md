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

`pnpm start` runs `prisma db push` before `next start`, so a fresh database gets its schema on first boot. `GET /api/health` reports whether the database, the schema, and the hyperliquid api are reachable, and which required env vars are missing. on railway: one web service with `pnpm start`, one worker service with `pnpm worker`, one postgres, `DATABASE_URL=${{Postgres.DATABASE_URL}}` on both.

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

## receipts

a thesis is bound to a position id at post time. when the worker sees that position close it sets the outcome from on-chain fills: `LIQUIDATED` if a liquidation fill closed it, `DUMPED` if it closed within 60 minutes of the thesis, otherwise `PROFIT` or `LOSS` from realised pnl. the outcome is on the feed card, the profile, and the share page.

## indexer

`worker/index.ts` polls every `TrackedAddress`. `clearinghouseState` is weight 2 and `userFills` is weight 20, so with 200 addresses a full pass at 1000 weight / min takes about 24 seconds, not 5. the worker is budget bound with a token bucket and only fetches fills when a position changed (or every 10 minutes). our own users are also subscribed to websocket `userFills`, capped at hyperliquid's 10 unique users per ip, so their trades show within a second.

on startup and every hour the worker mirrors hyperliquid's own leaderboard (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`, the feed behind app.hyperliquid.xyz/leaderboard) into `HlLeaderboardEntry`: the same 30-day window, the same exclusion rule (under 100k account value and under 10M volume), sorted by 30d pnl, top `HL_LEADERBOARD_TOP_N` (10). account value, pnl, roi and volume are stored exactly as hyperliquid reports them and shown on `/leaderboard` under the default "hyperliquid 30d" tab, so launch-day rankings match hyperliquid to the cent. the same ordering seeds the tracked address list, so those traders' positions are indexed first. if the worker is not running, the web process fetches the board itself on the first request and re-fetches in the background once it is older than the refresh interval. the feed is always mainnet. if it is unreachable, the board is rebuilt for the featured traders from the `portfolio` info endpoint (exact pnl and volume, roi against the window's starting account value) and labelled as such.

`src/lib/featured.ts` holds hand-verified traders (copied from hyperliquid's leaderboard) that are always tracked with source MANUAL, so they are polled before discovered addresses from the first cycle. `pnpm hl:top` prints that top 10 (full addresses, account value, pnl, roi, volume) from your own machine, plus a ready `SEED_ADDRESSES` line.

positions and fills are mirrored from chain and never written by the client. `lib/indexer.ts` is shared by the worker and the trade route.

## layout

`/` and `/m/[coin]`: feed on the left (feed / alerts / tokens / leaderboard tabs, filters for thesis only, following only, min size, market), chart and positions table in the centre, trade panel on the right. `/t/[handle]` works for any hyperliquid address, claimed or not. `/t/[handle]/thesis/[id]` is the share page with an og image and an x share button. `/leaderboard` opens on hyperliquid's own 30d top 10, then ranks our indexed traders by 7d pnl, win rate, thesis accuracy, followers, minimum 5 closed trades.

## not in the mvp

no custom contracts, no copy trading, no solana deposits (arbitrum usdc through the native bridge only), no spot, no comments, no mobile app. x handle is free text for now; oauth is a follow up.
