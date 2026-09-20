import { simulateExfressoRunner } from "../src/lib/handoff.js";
import { MAIL_FROM, formatQuoteEmail, formatQuoteEmailHtml } from "../src/lib/email.js";
import { mintCartesiaToken, synthesizeCartesiaTts } from "../token-proxy/src/mint.js";
import { evaluateUtteranceJev } from "../token-proxy/src/jev.js";
import { evaluateDomAction } from "../token-proxy/src/jev-action.js";
import { dispatchEmailApi, isEmailApiPath } from "../token-proxy/src/email-verify.js";
import { sendSmtpMail } from "../token-proxy/src/smtp-send.js";

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8") || "{}";
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function routePath(url) {
  const path = (url || "").split("?")[0];
  return path.replace(/^\/freightlodge-voice-quote/, "") || "/";
}

async function handler(req, res, next) {
  const path = routePath(req.url);
  if (
    req.method === "OPTIONS" &&
    (path === "/api/quote-handoff" ||
      path === "/api/email-quote" ||
      path === "/api/email/quote" ||
      path === "/api/email/verify/start" ||
      path === "/api/email/verify/confirm" ||
      path === "/api/stt-token" ||
      path === "/api/tts" ||
      path === "/api/jev" ||
      path === "/api/jev-action")
  ) {
    res.statusCode = 204;
    res.end();
    return;
  }

  if ((req.method === "POST" || req.method === "GET") && path === "/api/stt-token") {
    const apiKey = process.env.CARTESIA_API_KEY;
    if (!apiKey) {
      send(res, 503, { error: "STT token proxy not configured" });
      return;
    }
    try {
      const minted = await mintCartesiaToken({ apiKey });
      send(res, 200, minted);
    } catch (err) {
      send(res, 502, { error: String(err.message || err) });
    }
    return;
  }

  if ((req.method === "POST" || req.method === "GET") && path === "/api/jev-action") {
    if (req.method === "GET") {
      send(res, 200, { ok: true, jev: process.env.TYPESAFE_API_KEY ? "on" : "off", action: true });
      return;
    }
    const typesafeKey = process.env.TYPESAFE_API_KEY;
    if (!typesafeKey) {
      send(res, 503, { ok: false, jev: "off", error: "Jev proxy not configured" });
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
      send(res, 200, result);
    } catch (err) {
      const status = err?.code === "JEV_EMPTY" ? 400 : 502;
      send(res, status, { ok: false, jev: "off", error: String(err.message || err) });
    }
    return;
  }

  if ((req.method === "POST" || req.method === "GET") && path === "/api/jev") {
    if (req.method === "GET") {
      send(res, 200, { ok: true, jev: process.env.TYPESAFE_API_KEY ? "on" : "off" });
      return;
    }
    const typesafeKey = process.env.TYPESAFE_API_KEY;
    if (!typesafeKey) {
      send(res, 503, { ok: false, jev: "off", error: "Jev proxy not configured" });
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
      send(res, 200, result);
    } catch (err) {
      const status = err?.code === "JEV_EMPTY" ? 400 : 502;
      send(res, status, { ok: false, jev: "off", error: String(err.message || err) });
    }
    return;
  }

  if (req.method === "POST" && path === "/api/tts") {
    const apiKey = process.env.CARTESIA_API_KEY;
    if (!apiKey) {
      send(res, 503, { error: "STT token proxy not configured" });
      return;
    }
    try {
      const body = await readJson(req);
      const audio = await synthesizeCartesiaTts({
        apiKey,
        transcript: body.transcript || body.text || "",
        voiceId: body.voice_id,
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      res.end(Buffer.from(audio));
    } catch (err) {
      const status = err?.code === "TTS_EMPTY" ? 400 : 502;
      send(res, status, { error: String(err.message || err) });
    }
    return;
  }

  if (req.method === "POST" && path === "/api/quote-handoff") {
    try {
      const body = await readJson(req);
      const sheet = body.quote_sheet;
      if (!sheet) {
        send(res, 400, { ok: false, error: "quote_sheet is required" });
        return;
      }
      if (sheet.status === "out_of_scope") {
        send(res, 200, {
          ok: false,
          mode: "stub",
          quote_sheet: { ...sheet, quote_result: null },
        });
        return;
      }
      const result = simulateExfressoRunner({ ...sheet, status: "ready_for_quote" });
      send(res, 200, result);
    } catch (err) {
      send(res, 400, { ok: false, error: String(err.message || err) });
    }
    return;
  }

  if (req.method === "POST" && isEmailApiPath(path)) {
    try {
      const body = await readJson(req);
      if ((path === "/api/email-quote" || path === "/api/email/quote") && body.quote_sheet) {
        const formatted = formatQuoteEmail(body.quote_sheet);
        const htmlFormatted = formatQuoteEmailHtml(body.quote_sheet);
        body.subject = body.subject || formatted.subject;
        body.body = body.body || formatted.body;
        body.html = body.html || htmlFormatted.html;
        body.to = body.to || body.quote_sheet.contact?.email;
        body.from = body.from || MAIL_FROM;
      }
      const ip =
        req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
        req.socket?.remoteAddress ||
        "local";
      const result = await dispatchEmailApi(path, body, {
        env: process.env,
        ip,
        sendMail: process.env.SMTP_PASS ? (msg) => sendSmtpMail(msg, process.env) : undefined,
      });
      send(res, result.status, result.body);
    } catch (err) {
      send(res, 400, { ok: false, error: String(err.message || err) });
    }
    return;
  }

  next();
}

export function quoteApiPlugin() {
  return {
    name: "freightlodge-quote-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
