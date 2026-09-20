import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyQuotedLayout } from "../src/app.js";

function mockEls() {
  const classes = new Set();
  return {
    chatCol: {
      classList: {
        toggle(name, on) {
          if (on) classes.add(name);
          else classes.delete(name);
        },
        has(name) {
          return classes.has(name);
        },
      },
    },
    form: { hidden: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
    tip: { hidden: false },
  };
}

describe("Quoted layout — composer and tip do not overlay the quote card", () => {
  it("hides the sticky composer and voice tip only while status is quoted", () => {
    const els = mockEls();
    applyQuotedLayout(els, "collecting");
    expect(els.chatCol.classList.has("is-quoted")).toBe(false);
    expect(els.form.hidden).toBe(false);
    expect(els.tip.hidden).toBe(false);
    expect(els.form.attrs["aria-hidden"]).toBe("false");

    applyQuotedLayout(els, "quoted");
    expect(els.chatCol.classList.has("is-quoted")).toBe(true);
    expect(els.form.hidden).toBe(true);
    expect(els.tip.hidden).toBe(true);
    expect(els.form.attrs["aria-hidden"]).toBe("true");

    applyQuotedLayout(els, "collecting");
    expect(els.chatCol.classList.has("is-quoted")).toBe(false);
    expect(els.form.hidden).toBe(false);
    expect(els.tip.hidden).toBe(false);
  });

  it("quoting / error / out_of_scope keep the composer available", () => {
    for (const status of ["quoting", "error", "out_of_scope", "ready_for_quote"]) {
      const els = mockEls();
      applyQuotedLayout(els, status);
      expect(els.form.hidden, status).toBe(false);
      expect(els.tip.hidden, status).toBe(false);
      expect(els.chatCol.classList.has("is-quoted"), status).toBe(false);
    }
  });

  it("CSS takes the sticky panel and tip out of layout when Quoted", () => {
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/\.chat-col\.is-quoted\s+\.composer/);
    expect(css).toMatch(/\.chat-col\.is-quoted\s+\.voice-tip/);
    expect(css).toMatch(/\.composer\[hidden\]/);
    expect(css).toMatch(/\.voice-tip\[hidden\]/);
    expect(css).toMatch(/\.chat-col\.is-quoted\s+#quote-card:not\(:empty\)\s*\{[^}]*max-height:\s*none/);
  });

  it("markup still has the quote Email button and New sheet reset", () => {
    const app = readFileSync("src/app.js", "utf8");
    expect(app).toContain('id="voice-tip"');
    expect(app).toContain("applyQuotedLayout");
    expect(app).toContain("Email me this quote");
    expect(app).toContain('id="reset"');
    expect(app).toContain("New sheet");
    expect(app).toMatch(/state\.session = createSession\(\)/);
    const sendEmailFn = app.slice(app.indexOf("async function sendEmail"), app.indexOf("function push("));
    expect(sendEmailFn).not.toMatch(/location\.href/);
    expect(sendEmailFn).not.toMatch(/mailto/);
    expect(sendEmailFn).toContain("emailQuote");
  });
});
