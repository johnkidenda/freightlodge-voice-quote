#!/usr/bin/env node
/**
 * Local Node stub for the Cartesia token + TTS proxy.
 *
 *   CARTESIA_API_KEY= node token-proxy/local-stub.mjs
 *
 * Then point the Vite app at it:
 *   VITE_STT_TOKEN_URL=http://127.0.0.1:8787 npm run dev
 *
 * Mint: POST /
 * TTS audio: POST /tts  (CARTESIA_API_KEY stays on this process)
 */
import { createServer } from "node:http";
import { corsHeaders, mintCartesiaToken, synthesizeCartesiaTts } from "./src/mint.js";

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

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    send(res, 503, { error: "STT token proxy not configured" }, origin);
    return;
  }

  if (path === "/tts") {
    if (req.method !== "POST") {
      send(res, 405, { error: "method not allowed" }, origin);
      return;
    }
    try {
      const body = await readJson(req);
      const audio = await synthesizeCartesiaTts({
        apiKey,
        transcript: body.transcript || body.text || "",
        voiceId: body.voice_id,
      });
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        ...corsHeaders(origin),
      });
      res.end(Buffer.from(audio));
    } catch (err) {
      const status = err?.code === "TTS_EMPTY" ? 400 : 502;
      send(res, status, { error: String(err?.message || err) }, origin);
    }
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    send(res, 405, { error: "method not allowed" }, origin);
    return;
  }
  try {
    const minted = await mintCartesiaToken({ apiKey });
    send(res, 200, minted, origin);
  } catch (err) {
    send(res, 502, { error: String(err?.message || err) }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Cartesia token/TTS stub listening on http://${HOST}:${PORT}`);
  console.log("Mint: POST /   TTS: POST /tts   CARTESIA_API_KEY stays on this process only.");
});
