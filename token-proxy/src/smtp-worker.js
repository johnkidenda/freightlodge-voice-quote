/**
 * Minimal SMTP client for Cloudflare Workers via cloudflare:sockets.
 * Tries implicit TLS (465) then STARTTLS (587). Workers block outbound port 25.
 *
 * Env (Worker secrets — never VITE_*):
 *   SMTP_HOST  default smtp.hostinger.com
 *   SMTP_PORT  preferred port (465 or 587)
 *   SMTP_USER / SMTP_PASS / MAIL_FROM
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
    try { writer.releaseLock(); } catch { /* ignore */ }
    try { reader.releaseLock(); } catch { /* ignore */ }
    try { socket.close?.(); } catch { /* ignore */ }
  }

  return { expect, command, writer, encoder, close, socket };
}

async function openSocket(connect, host, port, mode) {
  const socket = connect(
    { hostname: host, port },
    { secureTransport: mode },
  );
  await socket.opened;
  return socket;
}

async function authenticate(session, user, pass) {
  const plain = encodeBase64(`\0${user}\0${pass}`);
  try {
    await session.command(`AUTH PLAIN ${plain}`, [235]);
  } catch {
    await session.command("AUTH LOGIN", [334]);
    await session.command(encodeBase64(user), [334]);
    await session.command(encodeBase64(pass), [235]);
  }
}

async function sendData(session, { from, to, subject, text, html }) {
  await session.command(`MAIL FROM:<${from}>`, [250]);
  await session.command(`RCPT TO:<${to}>`, [250, 251]);
  await session.command("DATA", [354]);

  const subj = encodeSubject(subject || "Freight Lodge");
  const bodyText = String(text || "");
  const bodyHtml = String(html || "").trim();
  const boundary = `fl-${crypto.randomUUID().replace(/-/g, "")}`;
  const headerLines = [`From: ${from}`, `To: ${to}`, `Subject: ${subj}`, "MIME-Version: 1.0"];
  let body;
  if (bodyHtml) {
    headerLines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      bodyText.replace(/^\./gm, ".."),
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: 8bit",
      "",
      bodyHtml.replace(/^\./gm, ".."),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  } else {
    headerLines.push("Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit");
    body = bodyText.replace(/^\./gm, "..");
  }
  const payload = `${headerLines.join("\r\n")}\r\n\r\n${body}\r\n.`;
  await session.writer.write(session.encoder.encode(`${payload}\r\n`));
  await session.expect([250]);
  try {
    await session.command("QUIT", [221]);
  } catch {
    /* quit ack optional */
  }
}

async function trySendOnPort(connect, cfg, msg, port, mode) {
  let socket;
  try {
    socket = await openSocket(connect, cfg.host, port, mode);
  } catch (err) {
    const e = new Error(`SMTP connect ${cfg.host}:${port}/${mode} failed: ${String(err?.message || err).slice(0, 120)}`);
    e.code = "SMTP_CONNECT";
    throw e;
  }

  let session = createSmtpSession(socket);
  try {
    await session.expect([220]);
    await session.command("EHLO freightlodge-worker", [250]);

    if (mode === "starttls") {
      await session.command("STARTTLS", [220]);
      // Upgrade; recreate session on TLS socket.
      try {
        session.writer.releaseLock();
      } catch { /* ignore */ }
      try {
        session.reader?.releaseLock?.();
      } catch { /* ignore */ }
      const tlsSocket = socket.startTls();
      await tlsSocket.opened;
      session = createSmtpSession(tlsSocket);
      await session.command("EHLO freightlodge-worker", [250]);
    }

    await authenticate(session, cfg.user, cfg.pass);
    await sendData(session, {
      from: String(msg.from || cfg.from).trim(),
      to: String(msg.to || "").trim(),
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  } finally {
    await session.close();
  }
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

  const preferred = Number(cfg.port) || 465;
  const attempts = [];
  if (preferred === 587) {
    attempts.push([587, "starttls"], [465, "on"]);
  } else {
    attempts.push([465, "on"], [587, "starttls"]);
  }

  const { connect } = await import("cloudflare:sockets");
  const errors = [];
  for (const [port, mode] of attempts) {
    if (port === 25) continue;
    try {
      await trySendOnPort(connect, cfg, { ...msg, to, from }, port, mode);
      return;
    } catch (err) {
      errors.push(`${port}/${mode}:${err?.code || "ERR"}:${String(err?.message || err).slice(0, 100)}`);
    }
  }
  const err = new Error(`SMTP all attempts failed: ${errors.join(" || ").slice(0, 240)}`);
  err.code = "SMTP_FAIL";
  throw err;
}
