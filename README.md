# Smart Sugar AI

## Local port

- Development: `http://localhost:3003`
- Production: `npm start` also uses port 3003.

## Install and run

```powershell
npm install
npm run dev
```

## Environment variables

Create `.env.local`:

```env
BARCHART_API_KEY=
VESSELFINDER_API_KEY=
WEATHER_LAT=-23.96
WEATHER_LON=-46.33
```

### Sugar No.11

The first card uses Barchart OnDemand `getQuote` for:
- `SBY00` — Sugar #11 Cash
- `SBH27` — March 2027
- `SBK27` — May 2027

It displays Last, Open, High, Low for each and calculates consecutive spreads from Last prices.

Barchart documents futures quote fields and supports futures symbols; the cash instrument is `SBY00`. See Barchart's API documentation and the public Barchart Sugar #11 page.

If `BARCHART_API_KEY` is empty, the app falls back to Yahoo Finance for a single delayed Sugar #11 quote, but it does not fabricate the three-contract OHLC values.

## Sources

- Barchart Sugar #11: https://www.barchart.com/futures/quotes/SB*0/futures-prices
- Barchart OnDemand Quote API: https://www.barchart.com/ondemand/api/getQuote
- ICE Sugar: https://www.ice.com/agriculture/sugar
- Open-Meteo: https://open-meteo.com/
- VesselFinder AIS: https://www.vesselfinder.com/realtime-ais-data

## Purchase recommendation

`/api/recommend` publishes a procurement proposal next to the headline price. It is
rule-based decision support, not a price forecast: every factor, its reading and its
weight are in `lib/recommend.ts`, so the call can be audited or re-tuned.

Factors: near-contract regression trend, cash-vs-near curve, near-vs-next roll spread,
BRL, Brent, dollar index, Centre-South Brazil rainfall, and breaking-headline count.

Output: action, share to fix now, suggested limit price, regression fair value, three
tranches with triggers, confidence, and a list of factors that failed to resolve.
Missing factors divide by the full weight budget (so a dropped bearish reading pulls
the score toward neutral) and cost 6 confidence points each.

Dependencies worth knowing:

- The cash leg is Yahoo `SB=F`. Stooq's `sb.f` row is a duplicate of the near
  contract, which flattens the curve to 0% and must not be used for it.
- Yahoo calls have a 6s timeout and the response is cached for 3 minutes in the
  unified cache (`X-Rec-Cache: hit|miss`, `X-Rec-Stale: 1` when served from the
  last good value); without both, a stalled upstream held the top card for 38s.
- Near-contract prices come from `data/contracts.json`, a Stooq daily snapshot, so
  they are delayed. The UI shows the snapshot age and never presents `updatedAt`
  (response time) as evidence of price freshness.

## Data layer (SQLite) and unified cache

User data is no longer trapped in the browser. Company inventory, vessels and the
market cache live in one SQLite database at `data/smart-sugar.db`, accessed through
Node's built-in `node:sqlite` (stable on Node 24 — no native dependency, no npm
install).

- `lib/db.ts` — connection, schema, `kv` key/value store and an append-only
  `audit_log`. If `./data` is read-only (Render/Vercel/Netlify) it degrades to an
  in-memory database so the app keeps running; the browser then keeps its copy in
  localStorage and syncs up when a writable store is available.
- `lib/cache.ts` — one shared TTL cache with single-flight de-duplication (N
  concurrent requests trigger one upstream fetch) and persistence of the last good
  value, so a restart or a flaky upstream serves labelled, slightly-stale data
  instead of an empty panel.
- `/api/inventory` — GET/PUT company books (PUT validates: `total` is mandatory).
- `/api/vessels` — GET/POST/PUT/DELETE/PATCH fleet CRUD. Ships carry optional
  `imo`/`mmsi`; `GET /api/vessels?ais=1` polls live VesselFinder positions when
  `VESSELFINDER_API_KEY` is set and returns an honest `ais.live:false` message
  otherwise (no fabricated coordinates). Live positions overlay the map but are
  not persisted — only manual entries are saved to the ledger.
- `/api/pricing` — pricing ledger CRUD: priced raw (NY No.11, ¢/lb) and white
  (London No.5, $/MT) lots with a quantity-weighted US$/tonne summary.
- `/api/contracts` — the full No.11 delivery curve as priced in the Stooq
  snapshot (source of the dashboard's contract selector).
- The assistant reads the persisted record when the browser sends nothing, so the
  same numbers appear on screen and in answers.

### Contract selector and White Premium

`ContractProvider` (`app/components/ContractContext.tsx`) is the single source of
truth for which No.11 delivery month is active across the price card, the chart
and the premium. Pin any priced month or stay on "auto" (nearest contract); the
choice persists per browser (`contract-selection-v1`).

- White Premium is computed live:
  `London #5 ($/MT) − NY #11 (¢/lb) × 22.0462262`, shown in the selector and in
  the London card.
- `/api/series?contract=SBH27` (any priced symbol) serves that month's daily
  history from the snapshot — honest per-contract data, daily granularity only.
  The query falls back to the full available series with an explanatory note when
  a short range would leave fewer than two bars.

Feeds on the shared cache: `market` (30s), `london` (60s), `recommend` (3min),
`sp500` (60s), `weather` (10min). `/api/series` and `/api/drivers` keep their own
specialised caches (per-range bars with stale fallback; disk mirror + background
refresh respectively).

### Health and periodic refresh

- `GET /api/health` — database status, stored keys, cache keys, and which
  integrations (LLM, Barchart, VesselFinder) are configured.
- `GET /api/refresh` — warms every feed through the app's own HTTP surface. Add
  `?what=market,drivers` to narrow it, `?force=1` to drop the cache first, and
  `?contracts=1` to also run the Stooq contract snapshot. Schedule it (Render cron,
  Windows Task Scheduler, uptime pinger) so panels are warm before anyone opens the
  dashboard: `npm run refresh` (uses `PORT`/`BASE_URL` when set).

## News ticker cold start

`/api/drivers` fetches 10 RSS queries, and Google throttles bursts, so a cold cache
took 10-40s and the ticker sat empty. The route now mirrors its last good build to
`data/drivers-cache.json` and serves it immediately, then refreshes in the background
(`refreshing: true`). Delete that file to force a cold rebuild.

## Deployment (Render)

`render.yaml` defines a Node web service. Point Render at the GitHub repository and it
will pick up the blueprint, or create the web service manually with:

- Build: `npm ci && npm run build`
- Start: `npm run start`
- `NEXT_PUBLIC_UPLOAD_ENABLED=0`

### Constraints

Document uploads are disabled by default. `/api/upload` persists to `./data`, which is
read-only and ephemeral on serverless and on Render's free plan, so the endpoint
returns `503` and the Files tab shows why. Everything else works: prices come from the
committed snapshot, and the drivers cache regenerates on boot.

To re-enable uploads, attach a persistent disk, mount it at the project directory, and
set `NEXT_PUBLIC_UPLOAD_ENABLED=1`.

`npm run fetch:contracts` needs a real Chrome and Playwright, so it cannot run on
Render. Refresh `data/contracts.json` locally and push it; the app serves the committed
snapshot until you do.
