import { simulateExfressoRunner } from "../src/lib/handoff.js";
import { MAIL_FROM, formatQuoteEmail } from "../src/lib/email.js";

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
  if (req.method === "OPTIONS" && (path === "/api/quote-handoff" || path === "/api/email-quote")) {
    res.statusCode = 204;
    res.end();
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

  if (req.method === "POST" && path === "/api/email-quote") {
    try {
      const body = await readJson(req);
      const sheet = body.quote_sheet || {};
      const formatted = formatQuoteEmail(sheet);
      const to = body.to || sheet.contact?.email;
      const payload = {
        ok: true,
        mode: "stub",
        sent: false,
        from: body.from || MAIL_FROM,
        to,
        subject: body.subject || formatted.subject,
        note: `Stub only — logged, not sent. Plug Hostinger SMTP here (smtp.hostinger.com:465, user ${MAIL_FROM}).`,
      };
      console.log("[email-quote stub]", JSON.stringify({ ...payload, body: body.body || formatted.body }, null, 2));
      send(res, 200, payload);
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
