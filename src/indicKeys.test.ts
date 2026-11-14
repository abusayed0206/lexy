import { describe, expect, it } from "vitest";
import { clusterBoundary, isIndic } from "./indicKeys";

describe("indicKeys helpers", () => {
  it("recognises Indic letters only", () => {
    expect(isIndic("ক")).toBe(true);
    expect(isIndic("্")).toBe(true); // virama
    expect(isIndic("ह")).toBe(true); // Devanagari
    expect(isIndic("a")).toBe(false);
    expect(isIndic("م")).toBe(false);
    expect(isIndic(undefined)).toBe(false);
  });

  it("finds grapheme boundaries with the conjunct rule", () => {
    const text = "ক্ষেত্র"; // ক্ষে (4) + ত্র (3)
    expect(clusterBoundary(text, 0, true)).toBe(4);
    expect(clusterBoundary(text, 4, true)).toBe(7);
    expect(clusterBoundary(text, 7, true)).toBeNull();
    expect(clusterBoundary(text, 7, false)).toBe(4);
    expect(clusterBoundary(text, 4, false)).toBe(0);
    expect(clusterBoundary(text, 0, false)).toBeNull();
    expect(clusterBoundary("আমি", 3, false)).toBe(1);
  });
});
