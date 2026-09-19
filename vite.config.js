import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { quoteApiPlugin } from "./server/vite-plugin-api.js";

const pagesBase = "/freightlodge-voice-quote/";
const base = process.env.VITE_BASE || (process.env.GITHUB_ACTIONS ? pagesBase : "/");

function readVersion() {
  try {
    return readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim().replace(/^v/i, "") || "0.26";
  } catch {
    return "0.26";
  }
}

function readCommit() {
  const fromEnv = process.env.VITE_APP_COMMIT || process.env.GITHUB_SHA;
  if (fromEnv) return String(fromEnv).trim().slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim().slice(0, 7);
  } catch {
    return "dev";
  }
}

const appVersion = readVersion();
const appCommit = readCommit();

function versionJsonPlugin() {
  return {
    name: "freightlodge-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify({ version: appVersion, commit: appCommit, label: `v${appVersion}` }, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  base,
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    "import.meta.env.VITE_APP_COMMIT": JSON.stringify(appCommit),
  },
  plugins: [quoteApiPlugin(), versionJsonPlugin()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
  },
});
