import { STT_TOKEN_UNCONFIGURED, getSttTokenUrl } from "./stt-providers.js";

let cache = null;

export function resetSttTokenCache() {
  cache = null;
}

export function tokenUnconfiguredError(message = STT_TOKEN_UNCONFIGURED) {
  const err = new Error(message);
  err.code = "STT_TOKEN_UNCONFIGURED";
  return err;
}

/**
 * Mint (or reuse) a short-lived Cartesia access_token from the server proxy.
 * Never accepts or embeds CARTESIA_API_KEY.
 */
export async function fetchSttAccessToken({
  url,
  fetchImpl,
  now = Date.now,
  minRemainingMs = 5000,
} = {}) {
  const tokenUrl = url == null ? getSttTokenUrl() : String(url).trim();
  if (!tokenUrl) throw tokenUnconfiguredError();

  const t = now();
  if (cache?.token && cache.expiresAt - t > minRemainingMs) {
    return { token: cache.token, expires_in: cache.expires_in, cached: true };
  }

  const fetchFn = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchFn) throw new Error("fetch is not available to mint an STT token");

  let res;
  try {
    res = await fetchFn(tokenUrl, {
      method: "POST",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new Error(`Could not reach STT token proxy (${err?.message || err})`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error || body?.message || "";
    } catch {
      /* ignore */
    }
    if (res.status === 503 || /not configured/i.test(detail)) {
      throw tokenUnconfiguredError(detail || STT_TOKEN_UNCONFIGURED);
    }
    throw new Error(detail || `STT token proxy failed (${res.status})`);
  }

  const data = await res.json();
  const token = data?.token;
  if (!token) throw new Error("STT token proxy returned no token");
  const expires_in = Number(data.expires_in) > 0 ? Number(data.expires_in) : 60;
  cache = {
    token,
    expires_in,
    expiresAt: t + expires_in * 1000,
  };
  return { token, expires_in, cached: false };
}
