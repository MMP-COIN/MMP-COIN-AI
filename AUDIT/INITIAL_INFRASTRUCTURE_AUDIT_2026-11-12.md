# MMP COIN AI — Initial Infrastructure Audit
Date: 2026-11-12
Scope: read-only inspection of GitHub repositories and Cloudflare configuration.
Target branch: preview/redesign-2026-11-13
No production code, Worker, schedule, database, KV value, secret, or Pages setting was changed.

## Executive summary

The current platform is salvageable based on the evidence inspected so far. The strongest confirmed risks are configuration/source drift and repeated deployment orchestration, not a confirmed Service Worker cache defect.

## Confirmed findings

### 1. Source and deployment duplication
- Canonical application source is `MMP-COIN/MMP-COIN-AI/www/`.
- `MMP-COIN/MMP-COIN-AI/index.html` is a small redirect to the public root domain, not the app.
- `MMP-COIN/MMP-COIN.github.io/index.html` is a generated root-domain mirror. Its Pages workflow checks out the canonical repository's `main`, copies `www/` files into the root repo artifact, and writes `version.json`.
- This mirror is intentional, but manual edits in the mirror instead of the canonical `www/` source can be overwritten at the next sync.
- The root Pages workflow also contains a `v4/` legacy app directory that is not part of the canonical source copy step. It remains in the root repository and needs reference/traffic verification before any removal.

### 2. Repeated Pages deployment trigger
- `MMP-COIN/MMP-COIN.github.io/.github/workflows/pages.yml` is configured for pushes, manual dispatch, and a `*/15 * * * *` schedule.
- The scheduled run rebuilds and deploys the site even when application source has not changed. It also regenerates the `updatedAt` field in `version.json` and attempts to persist the mirror.
- This is unnecessary deployment churn and can make release/version behavior harder to reason about. It is a high-priority candidate for correction, but was not changed during this audit.

### 3. Service Worker / PWA cache
- The recursive Git tree contains no obvious Service Worker or Workbox source file.
- The canonical 713 KB `www/index.html` contains no `navigator.serviceWorker`, `serviceWorker` registration, `caches.open`, or CacheStorage usage.
- It does contain custom native-app update logic using a no-store fetch, HTML hash comparison, and localStorage keys `mmp-live-page-hash-v1` and `mmp-live-page-pending-v1`.
- Therefore a conventional Service Worker cache is not supported as the cause of stale website content in the inspected source. The custom native update/reload flow and CDN/browser response headers still need runtime testing.

### 4. Cloudflare Worker inventory and schedule drift
Workers present:
- `mmp-coin-ai-analyzer`
- `mmp-coin-ai-analyzer-preview`
- `mmp-coin-ai-radar`
- `mmp-coin-ai-futures`
- `mmp-coin-ai-hunter-cron`
- `mmp-coin-ai-admin`
- `mmp-coin-ai-cron-test`

Observed schedules:
- Analyzer: no schedule returned by the Cloudflare schedules endpoint, despite the repository README describing a per-minute scheduled Spot Hunter cycle.
- Radar: `* * * * *`.
- Futures: `* * * * *`.
- Hunter universe refresher: `*/15 * * * *`, while the repository README describes `5 * * * *` (hourly).
- Admin, preview analyzer, and cron-test: no schedules.

This is confirmed configuration/documentation drift. The intended cadence and the deployed code's expected scheduler ownership must be reconciled before changing schedules.

### 5. Worker settings and provenance
- Production analyzer has D1 bindings for admin state and market cache, Workers AI binding, two rate-limit bindings, a Futures service binding, and secret bindings named `FUTURES_ENGINE_TOKEN` and `GROQ_API_KEY`.
- Production analyzer Worker cache setting is enabled, with cross-version cache disabled. Its actual effect on the affected endpoints needs targeted runtime tests before changing it.
- The preview analyzer currently exposes AI and rate-limit bindings but does not mirror the production analyzer's D1 and Futures service bindings. It is not yet a full-fidelity preview environment.
- The analyzer Worker settings annotation reports source commit `9ddd58402dbe7a9557fc6e68b064e4a49a09ba77`, while the inspected GitHub `main` head is `c5ab593ce27aa4a35fef6e6e9ec50e014029f74b`. This is a provenance discrepancy to investigate by comparing the complete deployed Worker bundle; the annotation alone does not prove the deployed code differs.

### 6. D1 and KV state (read-only queries)
- Both configured D1 databases have real tables and data. Cloudflare list metadata reported `num_tables: 0`, but querying `sqlite_master` confirmed tables and indexes; treat the list metadata as inconsistent rather than evidence of empty databases.
- Admin D1 counts observed: 1 admin user, 168 AI prediction rows, 1,265 analytics event rows, 14 Hunter engine state rows; daily analytics and AI daily-budget tables currently contain 0 rows.
- Market cache D1 contains 2,768 cache rows and reports a database size of approximately 72.6 MB.
- Radar KV namespace currently lists `radar:snapshot` and `radar:state`.
- No data was written or deleted.

### 7. Pages deployment snapshot
- The latest GitHub Pages deployment record inspected was successful at 2026-11-12 10:36:54 UTC.
- The root mirror's `version.json` build ID was `c5ab593ce27aa4a35fef6e6e9ec50e014029f74b`, matching the inspected canonical repository `main` head at that snapshot.
- This confirms source/mirror alignment for that deployment snapshot only; it does not prove all browser clients or CDN edges are serving the same response now.

## Priority next steps

1. Export and verify full D1 SQL backups and all Radar KV values before any destructive or schema-changing work.
2. Export each deployed Worker bundle completely and compare it byte-for-byte/module-by-module with the GitHub source and deployment annotations.
3. Reconcile the analyzer and Hunter cron schedules with the actual scheduler ownership in code and README.
4. Audit the root Pages workflow: remove unnecessary periodic redeploys only after confirming no hidden operational dependency; keep a single canonical source and generated mirror.
5. Trace the native-app HTML hash/reload logic and test CDN/browser cache headers with real HTTP responses.
6. Compare the preview Worker bindings with production and make preview isolated but functionally representative.
7. Run endpoint-level health, candle freshness, Radar snapshot age, Hunter snapshot age, and multi-exchange failover tests. Do not infer runtime health from configuration alone.

## Safety boundary
No production change is authorized by this audit report. Keep the live Pages site and production Workers intact until backups are complete, findings are validated, and preview tests pass. Secret values must remain in Cloudflare's secret store and must never be committed to Git.
