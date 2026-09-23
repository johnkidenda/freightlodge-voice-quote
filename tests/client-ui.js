import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** App shell plus src/ui. Source scans stay valid when markup moves between these files. */
export function readClientUi() {
  const files = ["src/app.js"];
  for (const name of readdirSync("src/ui").filter((entry) => entry.endsWith(".js")).sort()) {
    files.push(join("src/ui", name));
  }
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}
