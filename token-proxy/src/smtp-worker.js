/**
 * Minimal SMTP client for Cloudflare Workers via cloudflare:sockets.
 * Implicit TLS on port 465 only (Hostinger). Workers block outbound port 25.
 *
 * Env (Worker secrets — never VITE_*):
 *   SMTP_HOST  default smtp.hostinger.com
 *   SMTP_PORT  default 465
 *   SMTP_USER  default john@freightlodge.com
 *   SMTP_PASS  required
 *   MAIL_FROM  default john@freightlodge.com
 */
import { smtpSettings } from "./email-verify.js";

function encodeBase64(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function encodeSubject(subject) {
  const s = String(subject || "");
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${encodeBase64(s)}?=`;
}

/**
 * Line-oriented SMTP reader over a Transform stream buffer.
 */
function createSmtpSession(socket) {
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  async function readLine() {
    while (true) {
      const nl = buffer.indexOf("\n");
      if (nl >= 0) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) {
        const err = new Error("SMTP connection closed unexpectedly");
        err.code = "SMTP_CLOSED";
        throw err;
      }
      buffer += decoder.decode(value, { stream: true });
    }
  }

  async function readResponse() {
    const lines = [];
    while (true) {
      const line = await readLine();
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line) && line.length >= 3 && line[3] !== "-") {
        return { code: Number(line.slice(0, 3)), lines };
      }
    }
  }

  async function expect(okCodes) {
    const reply = await readResponse();
    if (!okCodes.includes(reply.code)) {
      const err = new Error(`SMTP ${reply.code}: ${reply.lines.join(" | ").slice(0, 160)}`);
      err.code = "SMTP_PROTO";
      throw err;
    }
    return reply;
  }

  async function command(line, okCodes) {
    await writer.write(encoder.encode(`${line}\r\n`));
    return expect(okCodes);
  }

  async function close() {
    try {
      writer.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
    try {
      socket.close?.();
    } catch {
      /* ignore */
    }
  }

  return { expect, command, writer, encoder, close };
}

/**
 * @param {{ to: string, from?: string, subject: string, text?: string, html?: string }} msg
 * @param {Record<string, string>} env
 */
export async function sendSmtpMailWorker(msg, env = {}) {
  const cfg = smtpSettings(env);
  if (!cfg.pass) {
    const err = new Error("SMTP_PASS is not set");
    err.code = "SMTP_UNCONFIGURED";
    throw err;
  }
  const to = String(msg.to || "").trim();
  const from = String(msg.from || cfg.from).trim();
  if (!to || !from) {
    const err = new Error("SMTP requires from and to");
    err.code = "SMTP_BAD_ADDR";
    throw err;
  }

  const port = Number(cfg.port) === 465 || !cfg.port ? 465 : Number(cfg.port);
  if (port === 25) {
    const err = new Error("Workers cannot open SMTP port 25; use 465");
    err.code = "SMTP_PORT";
    throw err;
  }

  const { connect } = await import("cloudflare:sockets");
  const socket = connect(
    { hostname: cfg.host, port },
    { secureTransport: port === 465 ? "on" : "starttls" },
  );
  await socket.opened;
  const session = createSmtpSession(socket);

  try {
    await session.expect([220]);
    await session.command("EHLO freightlodge-worker", [250]);

    await session.command("AUTH LOGIN", [334]);
    await session.command(encodeBase64(cfg.user), [334]);
    await session.command(encodeBase64(cfg.pass), [235]);

    await session.command(`MAIL FROM:<${from}>`, [250]);
    await session.command(`RCPT TO:<${to}>`, [250, 251]);
    await session.command("DATA", [354]);

    const subject = encodeSubject(msg.subject || "Freight Lodge");
    const text = String(msg.text || "");
    const html = String(msg.html || "").trim();
    const boundary = `fl-${crypto.randomUUID().replace(/-/g, "")}`;
    const headerLines = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0"];
    let body;
    if (html) {
      headerLines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      body = [
        `--${boundary}`,
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        text.replace(/^\./gm, ".."),
        `--${boundary}`,
        "Content-Type: text/html; charset=utf-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        html.replace(/^\./gm, ".."),
        `--${boundary}--`,
        "",
      ].join("\r\n");
    } else {
      headerLines.push("Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit");
      body = text.replace(/^\./gm, "..");
    }
    const payload = `${headerLines.join("\r\n")}\r\n\r\n${body}\r\n.`;
    await session.writer.write(session.encoder.encode(`${payload}\r\n`));
    await session.expect([250]);
    try {
      await session.command("QUIT", [221]);
    } catch {
      /* quit ack optional */
    }
  } finally {
    await session.close();
  }
}
