import { corsHeaders, mintCartesiaToken, synthesizeCartesiaTts } from "./mint.js";
import { evaluateUtteranceJev } from "./jev.js";
import { evaluateDomAction } from "./jev-action.js";

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

function routePath(url) {
  const path = new URL(url).pathname.replace(/\/$/, "") || "/";
  return path;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const path = routePath(request.url);
    const apiKey = env?.CARTESIA_API_KEY;

    if (request.method === "GET" && path === "/") {
      return json(
        {
          ok: true,
          service: "freightlodge-stt-token",
          tts: Boolean(apiKey),
          jev: Boolean(env?.TYPESAFE_API_KEY),
        },
        200,
        origin,
      );
    }

    if (path === "/jev-action") {
      if (request.method === "GET") {
        return json({ ok: true, jev: env?.TYPESAFE_API_KEY ? "on" : "off", action: true }, 200, origin);
      }
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);
      const typesafeKey = env?.TYPESAFE_API_KEY;
      if (!typesafeKey) {
        return json({ ok: false, jev: "off", error: "Jev proxy not configured" }, 503, origin);
      }
      const body = await readJson(request);
      try {
        const result = await evaluateDomAction({
          apiKey: typesafeKey,
          sheet: body.sheet || body.quote_sheet || {},
          candidates: body.candidates || body.visible_candidates || [],
          step: body.step || body.form_step || null,
          status: body.status || body.form_status || null,
          filled: body.filled || body.filled_snapshot || body.values || null,
        });
        return json(result, 200, origin);
      } catch (err) {
        const message = String(err?.message || err);
        const status = err?.code === "JEV_UNCONFIGURED" ? 503 : err?.code === "JEV_EMPTY" ? 400 : 502;
        return json({ ok: false, jev: "off", error: message }, status, origin);
      }
    }

    if (path === "/jev") {
      if (request.method === "GET") {
        return json({ ok: true, jev: env?.TYPESAFE_API_KEY ? "on" : "off" }, 200, origin);
      }
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);
      const typesafeKey = env?.TYPESAFE_API_KEY;
      if (!typesafeKey) {
        return json({ ok: false, jev: "off", error: "Jev proxy not configured" }, 503, origin);
      }
      const body = await readJson(request);
      try {
        const result = await evaluateUtteranceJev({
          apiKey: typesafeKey,
          utterance: body.utterance || body.transcript || body.text || "",
          sheet: body.sheet || body.quote_sheet || {},
          recentReplies: body.recent_replies || body.recentReplies || [],
          awaiting: body.awaiting || null,
          askedAccessorials: body.asked_accessorials ?? body.askedAccessorials,
        });
        return json(result, 200, origin);
      } catch (err) {
        const message = String(err?.message || err);
        const status = err?.code === "JEV_UNCONFIGURED" ? 503 : err?.code === "JEV_EMPTY" ? 400 : 502;
        return json({ ok: false, jev: "off", error: message }, status, origin);
      }
    }

    if (path === "/tts") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);
      if (!apiKey) return json({ error: "STT token proxy not configured" }, 503, origin);
      const body = await readJson(request);
      const transcript = body.transcript || body.text || "";
      try {
        const audio = await synthesizeCartesiaTts({ apiKey, transcript, voiceId: body.voice_id });
        return new Response(audio, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
            ...corsHeaders(origin),
          },
        });
      } catch (err) {
        const message = String(err?.message || err);
        const status = err?.code === "STT_TOKEN_UNCONFIGURED" ? 503 : err?.code === "TTS_EMPTY" ? 400 : 502;
        return json({ error: message }, status, origin);
      }
    }

    if (request.method !== "POST" && request.method !== "GET") {
      return json({ error: "method not allowed" }, 405, origin);
    }

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
