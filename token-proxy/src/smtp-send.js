/**
 * Node-only Hostinger SMTP send. Do not import into the Cloudflare Worker bundle. The Worker uses smtp-worker.js (cloudflare:sockets) instead.
 *
 * Env (never VITE_*):
 *   SMTP_HOST  default smtp.hostinger.com
 *   SMTP_PORT  default 465
 *   SMTP_USER  default john@freightlodge.com
 *   SMTP_PASS  required to actually send
 *   MAIL_FROM  default john@freightlodge.com
 */
import nodemailer from "nodemailer";
import { smtpSettings } from "./email-verify.js";

export function createSmtpTransport(env = process.env) {
  const cfg = smtpSettings(env);
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
}

export async function sendSmtpMail({ to, from, subject, text, html }, env = process.env) {
  const cfg = smtpSettings(env);
  if (!cfg.pass) {
    const err = new Error("SMTP_PASS is not set");
    err.code = "SMTP_UNCONFIGURED";
    throw err;
  }
  const transport = createSmtpTransport(env);
  try {
    await transport.sendMail({
      from: from || cfg.from,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    });
  } finally {
    transport.close?.();
  }
}
