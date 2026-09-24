import { corsHeaders } from "./cors.js";
import { evaluateUtteranceJev } from "./jev.js";
import { evaluateDomAction } from "./jev-action.js";
import { dispatchEmailApi, isEmailApiPath, smtpPasswordSet } from "./email-verify.js";
import { sendSmtpMailWorker } from "./smtp-worker.js";

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
  return new URL(url).pathname.replace(/\/$/, "") || "/";
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function mailSender(env) {
  if (!smtpPasswordSet(env || {})) return undefined;
  return (msg) => sendSmtpMailWorker(msg, env || {});
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const path = routePath(request.url);

    if (request.method === "GET" && path === "/") {
      return json(
        {
          ok: true,
          service: "freightlodge-stt-token",
          jev: Boolean(env?.TYPESAFE_API_KEY),
          email: smtpPasswordSet(env || {}),
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

    if (isEmailApiPath(path)) {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405, origin);
      const body = await readJson(request);
      const ip =
        request.headers.get("CF-Connecting-IP") ||
        request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
        "unknown";
      const result = await dispatchEmailApi(path, body, {
        env: env || {},
        ip,
        sendMail: mailSender(env),
      });
      return json(result.body, result.status, origin);
    }

    return json({ error: "not found" }, 404, origin);
  },
};
