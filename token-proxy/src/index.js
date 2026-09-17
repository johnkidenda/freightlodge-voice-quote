import { corsHeaders, mintCartesiaToken } from "./mint.js";

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method === "GET" && new URL(request.url).pathname === "/") {
      return json({ ok: true, service: "freightlodge-stt-token" }, 200, origin);
    }
    if (request.method !== "POST" && request.method !== "GET") {
      return json({ error: "method not allowed" }, 405, origin);
    }

    const apiKey = env?.CARTESIA_API_KEY;
    if (!apiKey) {
      return json({ error: "STT token proxy not configured" }, 503, origin);
    }

    try {
      const minted = await mintCartesiaToken({ apiKey });
      return json(minted, 200, origin);
    } catch (err) {
      const message = String(err?.message || err);
      const status = err?.code === "STT_TOKEN_UNCONFIGURED" ? 503 : 502;
      return json({ error: message }, status, origin);
    }
  },
};
