import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("no Cartesia in src/", () => {
  it("fails if the string cartesia appears anywhere under src/ (case-insensitive)", () => {
    const hits = [];
    for (const file of walk("src")) {
      const text = readFileSync(file, "utf8");
      if (/cartesia/i.test(text)) hits.push(file);
    }
    expect(hits, `Cartesia references remain in: ${hits.join(", ")}`).toEqual([]);
  });
});
