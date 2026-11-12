# MMP Independent Reliability Brain

A dedicated Cloudflare Worker that monitors the production system without running inside the market-analysis Workers.

## Responsibilities
- Independent one-minute Cron; it does not share execution time or memory with Analyzer, Radar, Futures, or Tether Workers.
- Read-only health probes through private service bindings for Analyzer, Radar, Futures, and Tether.
- Checks Spot/Futures/Radar snapshot freshness and Analyzer exchange-connection telemetry.
- Sends sanitized telemetry to Workers AI GPT-OSS 120B for evidence-based diagnosis and module-upgrade recommendations.
- Persists snapshots and repair history in the existing private D1 database.
- Performs only bounded, cooldown-protected retry actions for stale Spot/Futures Hunter cycles.
- Never edits source code, changes model weights, mutates Worker configuration, or deploys code automatically. Those actions require a reviewed patch and tests.

## Endpoints
- GET /health — liveness and binding status.
- GET /snapshot — latest persisted monitoring cycle.
- GET /events?limit=10 — recent history (maximum 30).

The dashboard is read-only. The monitor's scheduled process is the only actor allowed to perform the bounded retry actions.

## First-time setup
1. Apply `reliability-schema.sql` to the existing `mmp_coin_ai_private_admin` D1 database.
2. Deploy using `wrangler deploy --config reliability-wrangler.toml`.
3. Verify all four service bindings resolve to the production Workers and the AI binding is enabled.
4. Confirm the Cron trigger is enabled and GET /health reports `admin_db: true`.
5. Wait for one Cron cycle, then verify GET /snapshot. The GitHub Pages dashboard uses:
   `https://mmp-coin-ai-reliability.mehrdadmohammadi1988.workers.dev`.

## Safety boundaries
403/451 are diagnosed as access restrictions; the monitor does not try alternate domains to bypass them. It recommends authorized provider fallbacks. AI output is advisory only. Deterministic code gates every retry; retries are limited to existing bounded Hunter scan endpoints and a five-minute cooldown.
