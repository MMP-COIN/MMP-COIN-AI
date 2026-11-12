# MMP COIN AI — Infrastructure Audit Follow-up
Date: 2026-11-12
Branch: preview/redesign-2026-11-13
Scope: additional read-only runtime and deployment-pipeline verification.
Production Pages, Workers, D1 data, KV values, and secrets were not modified.

## New confirmed findings

### 1. Hunter universe refresh returns 503 because its Worker is missing bindings
The live `mmp-coin-ai-hunter-cron` Worker has `ADMIN_DB` and AI, but lacks `PUBLIC_API_LIMITER` and `MARKET_CACHE_DB`.
Its `refreshDigitalHunterUniverses()` calls the Analyzer's internal `/hunter-universe` handler using the refresher Worker's own `env`. `checkRateLimit()` returns `unavailable` when the limiter binding is absent, and `rateLimitReply()` converts that to HTTP 503.
This matches the persisted `Universe HTTP 503` error and stale Spot universe cache. The fix is to bind the same public limiter and market-cache D1 to the dedicated refresher Worker.

### 2. Cron ownership is inconsistent
- Analyzer production has no Cloudflare Cron schedule.
- Dedicated Hunter refresher is scheduled every 15 minutes in Cloudflare, but its Wrangler config says every minute.
- Analyzer source also attempts a 15-minute universe refresh. If the Analyzer minute Cron is enabled without removing that duplicate refresh, both Workers will fetch and write the same catalog.
- Intended ownership: Analyzer = Spot scan + local Tether monitor every minute; Futures Worker = Futures scan every minute; Hunter refresher = shared Spot/Futures universe refresh every 15 minutes; Radar = independent scan every minute.

### 3. Worker configuration files do not fully describe live bindings
- Analyzer Wrangler config omits the Futures service binding and the minute Cron.
- Hunter refresher config omits PUBLIC_API_LIMITER and MARKET_CACHE_DB.
- Radar Wrangler config omits ADMIN_DB even though its runtime persistence uses D1.
- Futures Worker has no dedicated Wrangler config in the repository.
These gaps make source-controlled configuration an unreliable representation of deployed infrastructure.

### 4. Health tests have false-positive and false-negative paths
- `/hunter-cron-status` reports one combined `updated_at` (the newest of Spot/Futures), and the workflow checks nonzero scan counts but not the age of each individual heartbeat. A fresh Futures heartbeat can mask a stale Spot heartbeat.
- The workflow probes the private Futures Worker through its public workers.dev URL, which returns 404; the Analyzer already exposes `/futures-engine-health` through the actual service binding.
- The AI smoke test's live Analyzer call returns HTTP 200, but the workflow then fails on an obsolete version-specific canary URL (HTTP 404). The test should use the stable preview Worker after it is fully provisioned.

### 5. Live source reliability and data freshness
At the time of inspection:
- Spot Hunter universe cache was approximately 10.8 hours old; the latest refresh recorded `Universe HTTP 503`.
- Futures provider diagnostics showed Binance/Bitget HTTP 403 and OKX HTTP 429, while Bybit/Gate/MEXC supplied data.
- Site browser logs showed intermittent 502 responses for Bitget, Wallex, and later CoinGecko pages; other providers and the candle endpoints still returned HTTP 200.
These are provider-specific failures; the system must use verified alternate sources and label stale/fallback data instead of treating every configured source as healthy.

### 6. Runtime engine versions differ
Latest persisted runtime heartbeats reported QIE-5.0.1 for Spot Hunter, but QIE-4.0.0 for Futures and Radar. Align and verify deployed Worker bundles before describing all engines as running the same version.

### 7. The update checker downloads the full HTML repeatedly
The page has two separate HTML-hash update loops: the general site checker polls the full page every two minutes, while the native-app checker polls it every five minutes. Both request a roughly 713 KB HTML document with cache-bypass headers and can independently trigger reloads. No Service Worker registration was found.
Replace these with one lightweight `version.json` poll, a single pending-update state, and one safe reload path. This is an infrastructure/update reliability change; no visual redesign is required.

### 8. Deployment workflow can publish before tests pass
The root Pages workflow deploys the artifact before desktop/mobile browser smoke tests finish. A recent run deployed the site, then failed its mobile check because it found zero visible Quantum Command cards. In the same run, desktop loaded terminal JS `?v=9` while mobile loaded `?v=8`, evidence that the two clients did not receive the same HTML/asset version during that test.
The Pages release pipeline should build and validate a preview artifact first, then deploy only after required infrastructure checks pass. Appearance-specific checks can remain separate until the later UI phase.

## Recovery markers
Read-only D1 Time Travel bookmarks captured during this audit:
- Admin D1: `000001f7-00000d71-00005121-f7599402ccbbe03c4862446d566ae4f7`
- Market-cache D1: `00000073-00000014-00005121-45c6e9dc1faa7b3cef03a770a7dab38f`

These are recovery bookmarks, not downloadable SQL exports. Full D1 exports and Radar KV value exports have not yet been completed. No export was started because D1 export can temporarily make the database unavailable; no production write or schema change has been made.

## Preview remediation staged
The preview branch stages:
- Explicit Cron and service/D1/rate-limit bindings in Wrangler config.
- A single owner for the 15-minute universe refresh.
- Per-Worker heartbeat timestamps in the status endpoint.
- Preview rate-limit key isolation.
- A static preview validation workflow that does not deploy to production.
No production deployment is authorized by this follow-up. Runtime validation on isolated preview databases and Workers is the next gate.


## Preview infrastructure created (isolated)
- Preview Admin D1: `mmp_coin_ai_preview_admin` — `396916eb-4b22-4f18-87d7-d8733b6a196a` (WEUR). Production schema copied only; no production rows copied.
- Preview Market Cache D1: `mmp_market_data_preview` — `4d03a56f-05c4-4cbf-8568-6fd124747002` (WEUR). Schema copied only.
- Preview Radar KV: `MMP-COIN-AI-Preview-Radar` — `9170b43c58d5476c96e64387b1c6ea34` (empty).
- Deployed isolated preview Workers: `mmp-coin-ai-analyzer-preview`, `mmp-coin-ai-futures-preview`, `mmp-coin-ai-hunter-cron-preview`, `mmp-coin-ai-radar-preview`. They use preview D1/KV bindings; workers.dev and Preview URLs are disabled, so these are not public.
- Preview Rate Limit keys are prefixed with `preview:` to avoid sharing counters with production, even though the same Cloudflare namespace IDs are reused.
- The account is on the Workers Free plan with a maximum of 5 Cron triggers. Production currently uses 3; preview can therefore run at most 2 additional Cron triggers concurrently. An attempt to add a third preview trigger was rejected with error 10072. Tests will be run sequentially, without upgrading the plan or disabling production schedules.
- Cloudflare documents that Cron trigger changes can take up to 15 minutes to propagate. The preview Cron configuration is present, but no preview heartbeat has been observed yet; runtime success is not claimed until the isolated D1 state confirms it.


## Update-checker remediation staged
The canonical `www/index.html` now uses one version checker:
- It polls the small `/version.json` document, not the full HTML page.
- It compares the deployed `build` ID with the `mmp-web-build` meta value.
- The native-app-specific and general HTML-hash loops were consolidated into the same checker; the native button calls that checker.
- A single reload path adds a unique cache-bypass parameter and waits until the user is not entering data or running an AI analysis.
- A session marker prevents repeated reload loops if a CDN edge continues serving an old HTML response.
- App version remains unchanged; this is a web-content update mechanism, not an APK version bump.
The preview validation workflow now compiles this script and checks that no full-HTML hash poll or second updater remains.
