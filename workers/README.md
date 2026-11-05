# MMP COIN AI — AI provider failover

This branch keeps the Cloudflare Worker source under version control and proposes a conservative, free-tier-only fallback.

## Routing order

1. Cloudflare Workers AI (the existing primary model).
2. Google Gemini `gemini-2.5-flash`, only when `GEMINI_API_KEY` is configured as a Cloudflare Worker Secret.

The Worker probes Cloudflare first on every analysis request. When the primary recovers after a quota reset, it is automatically selected again. Gemini is not called while Cloudflare succeeds.

## Free-tier and privacy notes

Google currently lists `gemini-2.5-flash` with a free tier for the Gemini Developer API. Free quotas, eligibility, and terms can change; check the official pricing page before enabling it. Google's free-tier terms may allow submitted content to be used to improve its products, so do not send private or sensitive user data through this fallback.

No paid provider is included in this proposal. In particular, no Groq model is configured because the currently documented GPT-OSS 120B hosted model is priced per token rather than being a guaranteed free-tier fallback.

## Optional setup before deployment

No external provider key was present in the connected Cloudflare Worker when this branch was prepared. Without `GEMINI_API_KEY`, the Worker will use Cloudflare Workers AI only and will return its normal unavailable response if the primary is unavailable.

If you choose to enable the optional Gemini fallback, create a key in the official Google AI Studio and add it directly to the Worker under **Settings → Variables and Secrets → Secrets** as `GEMINI_API_KEY`. Do not put keys in GitHub, the website, the Android app, source code, or this chat. Do not enable billing or paid upgrades for this project.

## Status endpoint

After deployment, `GET /ai-status` reports whether the optional Gemini secret is configured. It never returns secret values.

## Safety and release

This is a proposed source update only. It has not been deployed to the live Worker, website, or Android app. Review and test it before deployment. Exchange data, technical indicators, trade-plan validation, and the response schema are intended to remain unchanged; only AI inference routing and provider attribution are extended.

Official references:
- [Gemini API pricing and free-tier terms](https://ai.google.dev/gemini-api/docs/pricing)
- [Groq model pricing and supported models](https://console.groq.com/docs/models)
