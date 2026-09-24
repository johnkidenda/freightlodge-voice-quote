#!/usr/bin/env node
/**
 * Local Node stub for Jev + email (Resend).
 *
 *   TYPESAFE_API_KEY= RESEND_API_KEY= node token-proxy/local-stub.mjs
 *
 * Then point the Vite app at it:
 *   VITE_API_BASE_URL=http://127.0.0.1:8787 npm run dev
 *
 * Jev: POST /jev
 * Jev-action: POST /jev-action
 * Email: POST /email/verify/start|confirm and POST /email/quote
 */
import { createServer } from "node:http";
import { corsHeaders } from "./src/cors.js";
import { evaluateUtteranceJev } from "./src/jev.js";
import { evaluateDomAction } from "./src/jev-action.js";
import { dispatchEmailApi, isEmailApiPath } from "./src/email-verify.js";
import { resendConfigured, sendResendMail } from "./src/resend.js";

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";

function send(res, status, body, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(origin),
  };
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const path = (req.url || "/").split("?")[0].replace(/\/$/, "") || "/";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  const typesafeKey = process.env.TYPESAFE_API_KEY;

  if (req.method === "GET" && path === "/") {
    send(
      res,
      200,
      {
        ok: true,
        service: "freightlodge-stt-token",
        jev: Boolean(typesafeKey),
        email: resendConfigured(process.env),
      },
      origin,
    );
    return;
  }

  if (path === "/jev-action") {
    if (req.method === "GET") {
      send(res, 200, { ok: true, jev: typesafeKey ? "on" : "off", action: true }, origin);
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "method not allowed" }, origin);
      return;
    }
    if (!typesafeKey) {
      send(res, 503, { ok: false, jev: "off", error: "Jev proxy not configured" }, origin);
      return;
    }
    try {
      const body = await readJson(req);
      const result = await evaluateDomAction({
        apiKey: typesafeKey,
        sheet: body.sheet || body.quote_sheet || {},
        candidates: body.candidates || body.visible_candidates || [],
        step: body.step || body.form_step || null,
        status: body.status || body.form_status || null,
        filled: body.filled || body.filled_snapshot || body.values || null,
      });
      send(res, 200, result, origin);
    } catch (err) {
      const status = err?.code === "JEV_EMPTY" ? 400 : 502;
      send(res, status, { ok: false, jev: "off", error: String(err?.message || err) }, origin);
    }
    return;
  }

  if (isEmailApiPath(path)) {
    if (req.method !== "POST") {
      send(res, 405, { error: "method not allowed" }, origin);
      return;
    }
    try {
      const body = await readJson(req);
      const ip =
        req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
        req.socket?.remoteAddress ||
        "local";
      const result = await dispatchEmailApi(path, body, {
        env: process.env,
        ip,
        sendMail: resendConfigured(process.env) ? (msg) => sendResendMail(msg, process.env) : undefined,
      });
      send(res, result.status, result.body, origin);
    } catch (err) {
      send(res, 400, { ok: false, error: String(err?.message || err) }, origin);
    }
    return;
  }

  if (path === "/jev") {
    if (req.method === "GET") {
      send(res, 200, { ok: true, jev: typesafeKey ? "on" : "off" }, origin);
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "method not allowed" }, origin);
      return;
    }
    if (!typesafeKey) {
      send(res, 503, { ok: false, jev: "off", error: "Jev proxy not configured" }, origin);
      return;
    }
    try {
      const body = await readJson(req);
      const result = await evaluateUtteranceJev({
        apiKey: typesafeKey,
        utterance: body.utterance || body.transcript || body.text || "",
        sheet: body.sheet || body.quote_sheet || {},
        recentReplies: body.recent_replies || body.recentReplies || [],
        awaiting: body.awaiting || null,
        askedAccessorials: body.asked_accessorials ?? body.askedAccessorials,
      });
      send(res, 200, result, origin);
    } catch (err) {
      const status = err?.code === "JEV_EMPTY" ? 400 : 502;
      send(res, status, { ok: false, jev: "off", error: String(err?.message || err) }, origin);
    }
    return;
  }

  send(res, 404, { error: "not found" }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`Jev + email stub listening on http://${HOST}:${PORT}`);
  console.log("Jev: POST /jev   Jev-action: POST /jev-action");
  console.log("Email: POST /email/verify/start  POST /email/verify/confirm  POST /email/quote");
  console.log("TYPESAFE_API_KEY and RESEND_API_KEY stay on this process only.");
});
