import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { nextVersion } from "../scripts/bump-version.mjs";
import { formatAppVersionLabel, formatAppVersionTitle } from "../src/lib/app-version.js";
import { readClientUi } from "./client-ui.js";

describe("app version 0.XX", () => {
  it("VERSION is 0.38 for this ship", () => {
    const raw = readFileSync("VERSION", "utf8").trim();
    expect(raw).toBe("0.38");
    expect(formatAppVersionLabel(raw)).toBe("v0.38");
    expect(formatAppVersionTitle(raw, "abc1234")).toBe("v0.38 (abc1234)");
    expect(formatAppVersionTitle(raw, "dev")).toBe("v0.38");
  });

  it("bump script increments 0.XX by one", () => {
    expect(nextVersion("0.29")).toBe("0.30");
    expect(nextVersion("v0.09")).toBe("0.10");
  });

  it("footer shows the version and the header does not", () => {
    const app = readClientUi();
    const header = app.slice(app.indexOf("<header"), app.indexOf("</header>"));
    expect(header).not.toContain("app-version");
    expect(header).not.toContain("version-chip");
    expect(header).not.toContain("formatAppVersion");
    expect(app).toContain("formatAppVersionLabel");
    expect(app).toContain("app-version-foot");
    const css = readFileSync("src/style.css", "utf8");
    expect(css).not.toMatch(/\.version-chip/);
    expect(css).toMatch(/\.app-version-foot/);
  });

  it("CI auto-bumps VERSION on future PRs that do not already increment it", () => {
    const wf = readFileSync(".github/workflows/version-on-pr.yml", "utf8");
    expect(wf).toContain("bump-version.mjs");
    expect(wf).toContain("MAIN_VER");
    const deploy = readFileSync(".github/workflows/deploy-pages.yml", "utf8");
    expect(deploy).toContain("VITE_APP_COMMIT");
  });
});
