# MMP COIN AI — Cloudflare AI analyzer

This folder contains the secure backend for the market-analysis section on GitHub Pages.

## What it does
- Reads public Binance spot candles for 15m, 1h, 4h and 1d.
- Calculates RSI, EMA 20/50/200, MACD, ATR, 30-candle support/resistance, volume ratio and taker-buy ratio.
- When futures mode is selected, also reads Binance Futures funding and open interest when available.
- Adds Fear & Greed sentiment and CoinGecko global market context when those public endpoints respond.
- Sends the structured snapshot to Cloudflare Workers AI (Llama 3.3 70B) for a Persian BUY / SELL / WAIT report.
- Exposes `/market-flow?symbol=BTC&window=5` as a shared real-trade flow service. It aggregates actual Bybit Spot public trades first, then Binance aggregate trades as fallback; it reports trade count, provider, and whether the 1,000-record window may be truncated.
- Digital Hunter v2 runs independently on the analyzer Worker every minute, using a dedicated KV namespace and a rotating liquid-Spot universe. It derives 1m/3m/5m/15m momentum and structure from real 1m OHLCV candles across Binance, Bybit, Bitget, Gate, KuCoin and OKX; only candidates confirmed by real aggressive-buy/sell trade flow are published.
- `/hunter-snapshot` serves the persistent Hunter results; `/hunter-run` triggers a bounded manual cycle; `/hunter-scan?symbols=BTC,ETH` is the direct diagnostic scan endpoint. The browser only renders server snapshots and does not run its own scanner or ticker WebSockets.
- The scheduled Radar Worker remains independent and only consumes the shared flow service as supplemental evidence. Flow data does not change Radar scores or retention decisions.
- Never shows a fabricated fallback signal when data or AI is unavailable.

## Deploy (Cloudflare account required)
1. Sign in to Cloudflare and open **Workers & Pages**.
2. Create a Worker named `mmp-coin-ai-analyzer`.
3. Open the Worker editor and paste the contents of `worker.js` from this folder, then deploy.
4. In the Worker settings, open **Bindings** → **Add binding** → **Workers AI**. Set the variable name to exactly `AI`, save, and deploy again.
   Also add Rate Limiting bindings `AI_ANALYSIS_LIMITER` (15 requests per 60 seconds) and `PUBLIC_API_LIMITER` (300 requests per 60 seconds). The matching configuration is already in `wrangler.toml`.
5. Bind the dedicated Workers KV namespace `MMP-COIN-AI-Digital-Hunter` as `HUNTER_KV` and configure the `* * * * *` Cron trigger from `wrangler.toml`. The Radar Worker and its KV namespace remain separate.
6. Copy the Worker URL. The endpoint is the same URL with `/analyze` appended only if you later add a route; for this code the root URL itself handles POST requests.
7. In `index.html`, set `AI_ANALYSIS_ENDPOINT` to the deployed Worker root URL (including https://), commit, and wait for GitHub Pages deployment.

The `wrangler.toml` file is included for Wrangler-based deployment from this folder.

## Important
- Cloudflare Workers AI has a daily free Neurons allowance, not unlimited free usage. Check the current Cloudflare pricing and model availability for the account.
- Public market endpoints can rate-limit or change. The analyzer returns an error instead of inventing a signal if market data is missing.
- This is decision support, not financial advice or guaranteed profit. Futures and leverage can cause rapid losses.

## Security hardening
- Browser CORS is limited to the public GitHub Pages origin and supported Capacitor localhost origins.
- AI analysis is rate-limited to 5 requests per minute per client IP; health and exchange-support routes are limited to 60 requests per minute per client IP. Cloudflare Worker rate limits are approximate and scoped by Cloudflare location.
- AI requests must be JSON and are capped at 16 KB. The Worker fails closed if its rate-limit bindings are missing.
- Never put API tokens or secrets in `index.html`; keep any future credentials in Cloudflare Worker secrets.
