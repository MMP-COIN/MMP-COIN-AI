# Pre-reset infrastructure snapshot — 2026-11-12

This document records external runtime resources that are NOT part of the Git repository tree.
Do not delete or reset these resources until a separate replacement/migration plan is approved.

## Git snapshots
- MMP-COIN/MMP-COIN-AI default branch `main`: `c5ab593ce27aa4a35fef6e6e9ec50e014029f74b`
- MMP-COIN/MMP-COIN.github.io default branch `main`: `119403865cbd183384b42bcbce60f33de8b1e9a5`
- Full repository snapshots are preserved in branch `archive/pre-reset-full-2026-11-12` in each repository.

## Cloudflare account
- Account ID: `2120f8e58c2e72df4acadeb00999324a`
- Account name: Mehrdadmohammadi1988@gmail.com's Account
- Checked: 2026-11-12

## Worker scripts discovered
| Worker | Last modified (UTC) | Worker tag |
|---|---|---|
| mmp-coin-ai-admin | 2026-11-12T01:24:02.061096Z | 17723609bccb43eeb45f3981b4b10bff |
| mmp-coin-ai-analyzer | 2026-11-12T10:20:52.773770Z | b128c064470a435e97f6452667c5247f |
| mmp-coin-ai-analyzer-preview | 2026-11-12T00:01:04.172869Z | 776893c84c1a4440ac9a203431d9a0e2 |
| mmp-coin-ai-cron-test | 2026-11-10T15:32:28.198173Z | c4bfcce8f4b84f71ba2b4d7cd96e951d |
| mmp-coin-ai-futures | 2026-11-12T00:01:06.419246Z | f8839b1afd2546f8ba051e745783ae18 |
| mmp-coin-ai-hunter-cron | 2026-11-12T00:01:05.425439Z | 15a90e8d7fef442cb264ea7ca7aca428 |
| mmp-coin-ai-radar | 2026-11-12T01:21:29.094206Z | 6c6c506e972d483d9d7b554c875441b5 |

## Runtime bindings and schedules (names/IDs only; secret values intentionally excluded)
- Shared D1 ADMIN_DB: `dfb3ee95-ef2f-4067-a973-31b8fb1ee62f`
- Analyzer D1 MARKET_CACHE_DB: `45b2a51c-49d1-4e21-b13c-86e9d8fffa6e`
- Analyzer AI binding: `AI`
- Analyzer rate limits: `AI_ANALYSIS_LIMITER` namespace `2026110401`; `PUBLIC_API_LIMITER` namespace `2026110402`
- Analyzer service binding: `FUTURES_ENGINE` → `mmp-coin-ai-futures` (production)
- Analyzer secret binding names: `FUTURES_ENGINE_TOKEN`, `GROQ_API_KEY` (values are not exportable/readable here and must be preserved in Cloudflare)
- Futures secret binding name: `FUTURES_ENGINE_TOKEN`
- Radar KV namespace: `RADAR_KV` → `c87328700fbd4796bfd86b7a4df46648`
- Cron `mmp-coin-ai-futures`: `* * * * *`
- Cron `mmp-coin-ai-hunter-cron`: `*/15 * * * *`
- Cron `mmp-coin-ai-radar`: `* * * * *`
- All inspected Workers use compatibility date `2026-11-04`, usage model `standard`.

## Important exclusions / next backup tasks
- Secret values are deliberately not copied into Git, especially because these repositories are public. Do not rotate/delete them as part of a repository reset.
- D1 database contents, KV values, Worker source bundles, GitHub repository settings/secrets, Pages configuration, and release binaries are separate from the Git tree snapshot and still require dedicated exports/verification before any destructive reset.
- Keep the Cloudflare Worker scripts, D1 databases, KV namespace, cron schedules, GitHub Pages project, and release artifacts intact until their backups are separately verified.
