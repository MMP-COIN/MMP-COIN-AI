# MMP COIN AI — Cloudflare AI analyzer

This folder contains the secure backend for the market-analysis section on GitHub Pages.

## What it does
- Reads public Binance spot candles for 15m, 1h, 4h and 1d.
- Calculates RSI, EMA 20/50/200, MACD, ATR, 30-candle support/resistance, volume ratio and taker-buy ratio.
- When futures mode is selected, also reads Binance Futures funding and open interest when available.
- Adds Fear & Greed sentiment and CoinGecko global market context when those public endpoints respond.
- Sends the structured snapshot to GPT-OSS 120B through Groq when configured. Cloudflare Workers AI is a guarded fallback with an atomic D1-backed UTC daily call budget (default: 20 reservations/day); once reached, analysis continues with deterministic local calculations instead of calling Cloudflare AI. If D1 budget storage is unavailable, Cloudflare AI is blocked fail-closed.
- Exposes `/market-flow?symbol=BTC&window=5` as a shared real-trade flow service. It aggregates actual Bybit Spot public trades first, then Binance aggregate trades as fallback; it reports trade count, provider, and whether the 1,000-record window may be truncated.
- Spot Hunter cycles run from the analyzer Worker on its `* * * * *` trigger, using bounded rotating batches and the full validated universe without a fixed asset-count ceiling. The separate `mmp-coin-ai-hunter-cron` Worker only refreshes the Spot/Futures universe cache; keep it at `5 * * * *` (hourly), not every minute. The `mmp-coin-ai-futures` Worker runs its independent Futures scan every minute. Radar remains a separate every-minute Worker.
- `/hunter-snapshot` serves the persistent Hunter results; `/hunter-run` triggers a bounded manual cycle; `/hunter-scan?symbols=BTC,ETH` is the direct diagnostic scan endpoint. The browser only renders server snapshots and does not run its own scanner or ticker WebSockets.
- The scheduled Quantum Radar 3.0 Worker remains independent, consumes the shared executed-flow service, and requires order-book depth confirmation for its final quality gate.
- `market-data-core.js` provides shared OHLCV normalization, duplicate removal, freshness checks and closed-candle cross-exchange alignment for Hunter and Radar.
- `learning-engine.js` records qualified signal outcomes at 5m/15m/60m horizons. Confidence calibration activates only after at least 30 matured 5m outcomes, uses gross price return before fees/slippage, and is capped at ±5 points; it never overrides signal quality gates.
- Never shows a fabricated fallback signal when data or AI is unavailable.

## Deploy (Cloudflare account required)
1. Sign in to Cloudflare and open **Workers & Pages**.
2. Create a Worker named `mmp-coin-ai-analyzer`.
3. Open the Worker editor and paste the contents of `worker.js` from this folder, then deploy.
4. In the Worker settings, verify the `AI` Workers AI binding, `AI_ANALYSIS_LIMITER` (15 requests per 60 seconds), and `PUBLIC_API_LIMITER` (300 requests per 60 seconds). Keep `ADMIN_DB` connected to `mmp_coin_ai_private_admin` and `MARKET_CACHE_DB` connected to `mmp_market_data_fallback`. The `mmp_ai_daily_budget` table must exist in `ADMIN_DB`; it stores atomic UTC-day Cloudflare AI call reservations. Set `CF_AI_DAILY_MAX_CALLS` to adjust the default 20-call daily cap. If the D1 binding/table is unavailable, Workers AI calls are blocked rather than bypassing the cap. The matching bindings and default cap are declared in `wrangler.toml`.
5. Keep `mmp-coin-ai-analyzer` on `* * * * *` for Spot Hunter cycles; keep `mmp-coin-ai-hunter-cron` on `5 * * * *` for hourly universe refresh; keep `mmp-coin-ai-futures` on `* * * * *` for independent Futures cycles; and keep `mmp-coin-ai-radar` on its own `* * * * *` trigger with `ADMIN_DB` and `RADAR_KV`.
6. Copy the analyzer Worker URL. The endpoint is the same URL with `/analyze` appended only if you later add a route; for this code the root URL itself handles POST requests.
7. In `www/index.html`, keep `AI_ANALYSIS_ENDPOINT` pointed to the deployed analyzer Worker root URL (including https://), commit, and wait for GitHub Pages deployment.

The `wrangler.toml` file is included for Wrangler-based deployment from this folder.

## Important
- Cloudflare Workers AI has a daily free Neurons allowance, not unlimited free usage. Check the current Cloudflare pricing and model availability for the account.
- Market fallback cache writes to D1 are throttled to once per hour per key; last-known-good cache entries are retained for up to 24 hours and are marked stale when used after an upstream failure. Public market endpoints can rate-limit or change. The analyzer returns an error instead of inventing a signal if market data is missing. The specialist ensemble combines deterministic numeric experts; optional additional hosted model providers are used only when explicitly configured.
- This is decision support, not financial advice or guaranteed profit. Futures and leverage can cause rapid losses.

## Security hardening
- Browser CORS is limited to the public GitHub Pages origin and supported Capacitor localhost origins.
- AI requests are rate-limited per client IP; health, market-data and exchange-support routes use the separate public API limiter. Cloudflare Worker rate limits are approximate and scoped by Cloudflare location.
- AI requests must be JSON and are capped at 16 KB. The Worker fails closed if its rate-limit bindings are missing.
- Never put API tokens or secrets in `www/index.html`; keep any future credentials in Cloudflare Worker secrets.
