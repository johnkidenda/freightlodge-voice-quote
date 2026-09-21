import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { nextVersion } from "../scripts/bump-version.mjs";
import { formatAppVersionLabel, formatAppVersionTitle } from "../src/lib/app-version.js";

describe("app version 0.XX", () => {
  it("VERSION is 0.31 for this ship (30 merged + this PR)", () => {
    const raw = readFileSync("VERSION", "utf8").trim();
    expect(raw).toBe("0.31");
    expect(formatAppVersionLabel(raw)).toBe("v0.31");
    expect(formatAppVersionTitle("0.31", "abc1234")).toBe("v0.31 (abc1234)");
    expect(formatAppVersionTitle("0.31", "dev")).toBe("v0.31");
  });

  it("bump script increments 0.XX by one", () => {
    expect(nextVersion("0.29")).toBe("0.30");
    expect(nextVersion("v0.09")).toBe("0.10");
  });

  it("footer shows the version and the header does not", () => {
    const app = readFileSync("src/app.js", "utf8");
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
