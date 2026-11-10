# MMP COIN AI — Cloudflare AI analyzer

This folder contains the secure backend for the market-analysis section on GitHub Pages.

## What it does
- Reads public Binance spot candles for 15m, 1h, 4h and 1d.
- Calculates RSI, EMA 20/50/200, MACD, ATR, 30-candle support/resistance, volume ratio and taker-buy ratio.
- When futures mode is selected, also reads Binance Futures funding and open interest when available.
- Adds Fear & Greed sentiment and CoinGecko global market context when those public endpoints respond.
- Sends the structured snapshot to GPT-OSS 120B through Groq when configured, with Cloudflare Workers AI as fallback, for a Persian BUY / SELL / WAIT report.
- Exposes `/market-flow?symbol=BTC&window=5` as a shared real-trade flow service. It aggregates actual Bybit Spot public trades first, then Binance aggregate trades as fallback; it reports trade count, provider, and whether the 1,000-record window may be truncated.
- Digital Hunter v2 runs independently on the analyzer Worker every minute, using the existing private D1 database and a rotating top-96 liquid-Spot universe, scanning eight symbols per minute and refreshing the universe every ten minutes. It writes one compact state/snapshot row per completed cycle, avoiding the daily Workers KV write quota. It derives 1m/3m/5m/15m momentum and structure from real 1m OHLCV candles across Binance, Bybit, Bitget, Gate, KuCoin and OKX; only candidates confirmed by real aggressive-buy/sell trade flow are published.
- `/hunter-snapshot` serves the persistent Hunter results; `/hunter-run` triggers a bounded manual cycle; `/hunter-scan?symbols=BTC,ETH` is the direct diagnostic scan endpoint. The browser only renders server snapshots and does not run its own scanner or ticker WebSockets.
- The scheduled Radar Worker remains independent, consumes the shared executed-flow service, and requires order-book depth confirmation for its final quality gate.
- `market-data-core.js` provides shared OHLCV normalization, duplicate removal, freshness checks and closed-candle cross-exchange alignment for Hunter and Radar.
- `learning-engine.js` records qualified signal outcomes at 5m/15m/60m horizons. Confidence calibration activates only after at least 30 matured 5m outcomes and is capped at ±5 points; it never overrides signal quality gates.
- Never shows a fabricated fallback signal when data or AI is unavailable.

## Deploy (Cloudflare account required)
1. Sign in to Cloudflare and open **Workers & Pages**.
2. Create a Worker named `mmp-coin-ai-analyzer`.
3. Open the Worker editor and paste the contents of `worker.js` from this folder, then deploy.
4. In the Worker settings, open **Bindings** → **Add binding** → **Workers AI**. Set the variable name to exactly `AI`, save, and deploy again.
   Also add Rate Limiting bindings `AI_ANALYSIS_LIMITER` (15 requests per 60 seconds) and `PUBLIC_API_LIMITER` (300 requests per 60 seconds). The matching configuration is already in `wrangler.toml`.
5. Keep the existing D1 binding `ADMIN_DB` connected to `mmp_coin_ai_private_admin`; Hunter stores its cursor and snapshot in the isolated `hunter_engine_state` table. Configure the `* * * * *` Cron trigger from `wrangler.toml`. The Radar Worker and its KV namespace remain separate.
6. Copy the Worker URL. The endpoint is the same URL with `/analyze` appended only if you later add a route; for this code the root URL itself handles POST requests.
7. In `index.html`, set `AI_ANALYSIS_ENDPOINT` to the deployed Worker root URL (including https://), commit, and wait for GitHub Pages deployment.

The `wrangler.toml` file is included for Wrangler-based deployment from this folder.

## Important
- Cloudflare Workers AI has a daily free Neurons allowance, not unlimited free usage. Check the current Cloudflare pricing and model availability for the account.
- Public market endpoints can rate-limit or change. The analyzer returns an error instead of inventing a signal if market data is missing. The specialist ensemble combines deterministic numeric experts; optional additional hosted model providers are used only when explicitly configured.
- This is decision support, not financial advice or guaranteed profit. Futures and leverage can cause rapid losses.

## Security hardening
- Browser CORS is limited to the public GitHub Pages origin and supported Capacitor localhost origins.
- AI analysis is rate-limited to 5 requests per minute per client IP; health and exchange-support routes are limited to 60 requests per minute per client IP. Cloudflare Worker rate limits are approximate and scoped by Cloudflare location.
- AI requests must be JSON and are capped at 16 KB. The Worker fails closed if its rate-limit bindings are missing.
- Never put API tokens or secrets in `index.html`; keep any future credentials in Cloudflare Worker secrets.
