import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sticky composer — hold stays on-screen", () => {
  it("phone column scrolls only the thread; header + composer stay put", () => {
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/#app\s*\{[^}]*height:\s*100dvh/);
    expect(css).toMatch(/#app\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.stage\s*\{[^}]*min-height:\s*0/);
    expect(css).toMatch(/\.chat-col\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.thread\s*\{[^}]*flex:\s*1/);
    expect(css).toMatch(/\.thread\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.thread\s*\{[^}]*min-height:\s*0/);
    expect(css).toMatch(/\.composer\s*\{[^}]*flex-shrink:\s*0/);
    expect(css).toMatch(/\.composer\s*\{[^}]*position:\s*sticky/);
    expect(css).not.toMatch(/\.thread\s*\{[^}]*min-height:\s*240px/);
    expect(css).not.toMatch(/\.thread\s*\{[^}]*max-height:\s*calc\(100dvh/);
    expect(css).not.toMatch(/max-height:\s*calc\(100dvh - 390px\)/);
  });

  it("conversational icons sit next to the mode button", () => {
    const app = readFileSync("src/app.js", "utf8");
    const css = readFileSync("src/style.css", "utf8");
    expect(app).toContain("id=\"convo-audio\"");
    expect(app).toContain("speakerIcon");
    expect(app).toMatch(/is-muted/);
    expect(css).toMatch(/\.convo-audio/);
    expect(css).toMatch(/\.tts-wave\[hidden\]/);
  });

  it("hides the collecting sheet panel and the caption under Hold to talk", () => {
    const app = readFileSync("src/app.js", "utf8");
    const css = readFileSync("src/style.css", "utf8");
    expect(app).toContain('id="hold"');
    expect(app).toContain('id="thread"');
    expect(app).toContain("Hold to talk");
    expect(app).not.toContain("Sheet progress");
    expect(app).not.toContain('id="hold-hint"');
    expect(app).not.toContain('id="sheet-list"');
    expect(app).not.toContain('id="sheet-drawer"');
    expect(css).not.toMatch(/\.sheet-drawer/);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
