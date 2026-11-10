import { runDigitalHunterMarketCycle, refreshDigitalHunterUniverses } from "./worker.js";
import { QUANTUM_ENGINE_NAME, QUANTUM_ENGINE_VERSION } from "./quantum-core.js";

const HEARTBEAT_ID = "digital-hunter-cron-heartbeat";

async function writeHeartbeat(env, payload, now = Date.now()) {
  const serialized = JSON.stringify(payload);
  await env.ADMIN_DB.prepare(
    "INSERT INTO hunter_engine_state (id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at"
  ).bind(HEARTBEAT_ID, serialized, new Date(now).toISOString()).run();
}

async function runMarket(env, market, timeoutMs) {
  let timer;
  try {
    const result = await Promise.race([
      runDigitalHunterMarketCycle(env, market),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(market + " Hunter cycle exceeded " + timeoutMs + "ms")), timeoutMs);
      })
    ]);
    return {
      status: result?.status === "online" && Number(result?.failed_count || 0) === 0 ? "success" : "partial",
      scanned_count: Number(result?.scanned_count || 0),
      universe_count: Number(result?.universe_count || 0),
      failed_count: Number(result?.failed_count || 0),
      candidate_count: Number(result?.candidate_count || 0),
      signals_count: Array.isArray(result?.signals) ? result.signals.length : 0,
      checked_at: result?.checked_at || null,
      last_errors: Array.isArray(result?.last_errors) ? result.last_errors.slice(0, 8) : [],
      last_rejections: Array.isArray(result?.last_rejections) ? result.last_rejections.slice(0, 8) : []
    };
  } catch (error) {
    return {
      status: "error",
      scanned_count: 0,
      universe_count: 0,
      failed_count: 0,
      signals_count: 0,
      error: String(error?.message || error).slice(0, 220)
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default {
  async scheduled(event, env, ctx) {
    const now = Date.now();
    const cron = event?.cron || "* * * * *";
    const scheduledTime = Number(event?.scheduledTime || now);
    await writeHeartbeat(env, {
      status: "started",
      engine: QUANTUM_ENGINE_NAME,
      engine_version: QUANTUM_ENGINE_VERSION,
      cron,
      scheduledTime,
      markets: ["spot", "futures"]
    }, now);

    const [spot, futures] = await Promise.all([
      runMarket(env, "spot", 26000),
      runMarket(env, "futures", 28000)
    ]);
    const errors = [spot, futures]
      .filter(market => market.status === "error")
      .map(market => ({ market: market === spot ? "spot" : "futures", error: market.error }));

    const status = errors.length
      ? "partial"
      : spot.status === "success" && futures.status === "success"
        ? "success"
        : "partial";

    await writeHeartbeat(env, {
      status,
      engine: QUANTUM_ENGINE_NAME,
      engine_version: QUANTUM_ENGINE_VERSION,
      cron,
      scheduledTime,
      finishedAt: new Date().toISOString(),
      markets: { spot, futures },
      errors
    });

    const minute = new Date(scheduledTime).getUTCMinutes();
    if (ctx?.waitUntil && minute % 30 === 5) {
      ctx.waitUntil(
        refreshDigitalHunterUniverses(env).catch(error =>
          console.error("Hunter universe refresh failed:", error?.message || error)
        )
      );
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        status: "online",
        engine: QUANTUM_ENGINE_NAME,
        engine_version: QUANTUM_ENGINE_VERSION,
        cron: "* * * * *"
      });
    }
    if (url.pathname === "/status") {
      const row = await env.ADMIN_DB.prepare(
        "SELECT payload, updated_at FROM hunter_engine_state WHERE id = ?"
      ).bind(HEARTBEAT_ID).first();
      let saved = null;
      try { saved = row?.payload ? JSON.parse(row.payload) : null; } catch {}
      return Response.json(saved
        ? { ...saved, updated_at: row?.updated_at || null }
        : { status: "warming_up", engine: QUANTUM_ENGINE_NAME, engine_version: QUANTUM_ENGINE_VERSION });
    }
    return new Response("Not found", { status: 404 });
  }
};
