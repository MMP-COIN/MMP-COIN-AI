/**
 * MMP-COIN-AI internal bridge.
 * Private by design: workers.dev and public routes are disabled in wrangler config.
 * Callers must be explicitly granted a Workers Service Binding.
 */
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  }
});

const MARKET_TABLES = new Set(["market_data_cache"]);
const AI_MODELS = new Set([
  "@cf/meta/llama-3.1-8b-instruct",
  "@cf/openai/gpt-oss-120b"
]);

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/internal/status") {
    return json({
      service: "mmp-coin-ai-github-deploy",
      status: "online",
      access: "private-service-binding-only",
      bindings: {
        preview_radar: Boolean(env.PREVIEW_RADAR),
        fast_radar: Boolean(env.FAST_RADAR),
        market_data: Boolean(env.MARKET_DATA),
        admin_db: Boolean(env.ADMIN_DB),
        workers_ai: Boolean(env.AI)
      },
      timestamp: new Date().toISOString()
    });
  }

  const kvMatch = path.match(/^\/internal\/kv\/(preview-radar|fast-radar)\/(.+)$/);
  if (request.method === "GET" && kvMatch) {
    const namespace = kvMatch[1] === "preview-radar" ? env.PREVIEW_RADAR : env.FAST_RADAR;
    if (!namespace) return json({ error: "KV binding unavailable" }, 503);
    let key;
    try { key = decodeURIComponent(kvMatch[2]); } catch { return json({ error: "Invalid key encoding" }, 400); }
    if (!key || key.length > 512) return json({ error: "Invalid key" }, 400);
    const value = await namespace.get(key);
    if (value === null) return json({ error: "Not found" }, 404);
    return json({ namespace: kvMatch[1], key, value });
  }

  if (request.method === "GET" && path === "/internal/market-cache") {
    if (!env.MARKET_DATA) return json({ error: "Market D1 binding unavailable" }, 503);
    const table = url.searchParams.get("table") || "market_data_cache";
    if (!MARKET_TABLES.has(table)) return json({ error: "Table not permitted" }, 403);
    const parsedLimit = Number.parseInt(url.searchParams.get("limit") || "50", 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 100)) : 50;
    const result = await env.MARKET_DATA.prepare('SELECT * FROM "market_data_cache" LIMIT ?')
      .bind(limit).all();
    return json({ table, count: result.results?.length || 0, rows: result.results || [] });
  }

  if (request.method === "POST" && path === "/internal/ai") {
    if (!env.AI) return json({ error: "Workers AI binding unavailable" }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt || prompt.length > 12000) return json({ error: "Prompt must contain 1–12000 characters" }, 400);
    const model = AI_MODELS.has(body?.model) ? body.model : "@cf/meta/llama-3.1-8b-instruct";
    const result = await env.AI.run(model, { prompt, max_tokens: 768 });
    return json({ model, result });
  }

  if (request.method === "OPTIONS") return new Response(null, { status: 405 });
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      return json({ error: "Internal service error" }, 500);
    }
  }
};
