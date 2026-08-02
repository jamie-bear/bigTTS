import { describe, expect, it } from "vitest";
import { normalizeText } from "../../src/server.js";

describe("provider text normalization", () => {
  it("preserves valid multilingual prose and normalizes canonical equivalents", () => {
    expect(normalizeText("Cafe\u0301 — “你好！” 👩‍💻")).toBe("Café — “你好！” 👩‍💻");
  });

  it("normalizes unusual line and space separators", () => {
    expect(normalizeText("alpha\u0085beta\u2028gamma\u2029delta")).toBe("alpha\nbeta\ngamma\ndelta");
    expect(normalizeText("zero\u200bwidth\ufeffspace\u00a0here")).toBe("zero width space here");
  });

  it("removes malformed and non-interchange code points", () => {
    const unsafe = "a\u0000\u0080\ud800\ue000\ufdd0\ufffe\u{1ffff}\ufffd\u{e0001}b";
    expect(normalizeText(unsafe)).toBe("ab");
  });

  it("removes invisible layout controls without removing joiners used by languages and emoji", () => {
    expect(normalizeText("soft\u00adhyphen\u2060join\u202emark")).toBe("softhyphenjoinmark");
    expect(normalizeText("می‌خواهم 👩‍💻")).toBe("می‌خواهم 👩‍💻");
  });
});
