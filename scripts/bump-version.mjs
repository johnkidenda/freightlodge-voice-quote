#!/usr/bin/env node
/**
 * Increment VERSION 0.XX → 0.(XX+1).
 * Used by CI on PRs that do not already bump VERSION.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "VERSION");

export function nextVersion(current) {
  const raw = String(current || "").trim().replace(/^v/i, "");
  const m = raw.match(/^0\.(\d+)$/);
  const n = m ? Number(m[1]) : 0;
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`VERSION must be 0.XX, got ${JSON.stringify(current)}`);
  }
  return `0.${String(n + 1).padStart(2, "0")}`;
}

function isMain() {
  const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
  return import.meta.url === entry;
}

if (isMain()) {
  const current = readFileSync(file, "utf8");
  const bumped = nextVersion(current);
  writeFileSync(file, `${bumped}\n`);
  console.log(`VERSION ${String(current).trim()} → ${bumped}`);
}
