# MMP COIN AI — AI provider failover

This branch contains a source-controlled copy of the current `mmp-coin-ai-analyzer` Worker plus a conservative provider failover layer.

## Routing order

1. Cloudflare Workers AI (the existing primary model).
2. Google Gemini `gemini-3.8-flash`, only when `GEMINI_API_KEY` is configured.
3. Groq `openai/gpt-oss-120b`, only when `GROQ_API_KEY` is configured.

The Worker probes Cloudflare first on every analysis request. As soon as the primary starts responding again after its quota reset, it is automatically selected again. Fallback providers are never called while the primary succeeds.

## Required setup before deployment

No external provider keys were present in the connected Cloudflare Worker when this branch was prepared. The code therefore skips Gemini and Groq until their keys are added as **Worker Secrets**:

- `GEMINI_API_KEY`
- `GROQ_API_KEY`

Create the keys directly in the providers' official consoles and add them to the Worker under **Settings → Variables and Secrets → Secrets**. Do not put keys in GitHub, the website, the Android app, source code, or this chat.

Use only the providers' free plans and free-tier model access. Do not enable billing or paid upgrades. Free quotas and model availability are controlled by each provider and can change. The Worker never creates, rotates, or searches for replacement keys and never intentionally selects a paid model.

Official references:
- Google Gemini API pricing and free-tier terms: https://ai.google.dev/gemini-api/docs/pricing
- Groq supported models and rate limits: https://console.groq.com/docs/models
- Groq model deprecations: https://console.groq.com/docs/deprecations

## Status endpoint

After deployment, `GET /ai-status` reports which providers have secrets configured. It never returns secret values.

## Safety and release

This is a proposed change only. It has not been deployed to the live Worker, website, or Android app. Review and test it before deployment. The existing exchange data, technical indicators, trade-plan validation, and response schema remain unchanged; only the AI inference routing and provider attribution are extended.
