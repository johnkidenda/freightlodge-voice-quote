#!/usr/bin/env node
/**
 * Local Node stub for the Cartesia STT access-token proxy.
 *
 *   CARTESIA_API_KEY= node token-proxy/local-stub.mjs
 *
 * Then point the Vite app at it:
 *   VITE_STT_TOKEN_URL=http://127.0.0.1:8787 npm run dev
 */
import { createServer } from "node:http";
import { corsHeaders, mintCartesiaToken } from "./src/mint.js";

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

const server = createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }
  if (req.method !== "POST" && req.method !== "GET") {
    send(res, 405, { error: "method not allowed" }, origin);
    return;
  }
  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    send(res, 503, { error: "STT token proxy not configured" }, origin);
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
  console.log(`STT token stub listening on http://${HOST}:${PORT}`);
  console.log("Set VITE_STT_TOKEN_URL to that URL. CARTESIA_API_KEY stays on this process only.");
});
