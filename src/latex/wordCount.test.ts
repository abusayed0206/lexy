import { describe, expect, it } from "vitest";
import { countWords, projectWordCount, type WordCountCache } from "./wordCount";

describe("countWords", () => {
  it("counts prose but not commands, math, labels or comments", () => {
    expect(countWords("\\section{Getting started} We use $x^2 + y$ here.\\label{sec:a} % not this")).toBe(5);
  });

  it("counts Bangla words", () => {
    expect(countWords("আমার সোনার বাংলা")).toBe(3);
  });

  it("is zero for markup only", () => {
    expect(countWords("\\documentclass{article}\\usepackage{amsmath}")).toBe(0);
  });
});

describe("projectWordCount", () => {
  it("sums the document's files and reuses cached counts", () => {
    const cache: WordCountCache = new Map();
    const texts = new Map([
      ["main.tex", "One two"],
      ["ch.tex", "three"],
      ["other.tex", "not counted"],
    ]);
    expect(projectWordCount(["main.tex", "ch.tex"], texts, cache)).toBe(3);
    const cached = cache.get("main.tex");
    texts.set("ch.tex", "three four");
    expect(projectWordCount(["main.tex", "ch.tex"], texts, cache)).toBe(4);
    expect(cache.get("main.tex")).toBe(cached);
  });
});
