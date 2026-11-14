import { describe, expect, it } from "vitest";
import { spellWords } from "./editorAids";

const words = (text: string) => spellWords(text).map((hit) => hit.word);

describe("spellWords", () => {
  it("returns prose words with their offsets", () => {
    const text = "Teh \\textbf{quick} fox";
    expect(spellWords(text)).toEqual([
      { word: "Teh", from: 0, to: 3 },
      { word: "quick", from: 12, to: 17 },
      { word: "fox", from: 19, to: 22 },
    ]);
  });

  it("never offers commands, math, labels, keys, URLs or comments", () => {
    expect(words("\\documentclass{article} $\\alpha teh$ \\label{sec:teh} \\cite{tehkey} \\url{https://teh.org} % teh\nok")).toEqual(["ok"]);
  });

  it("skips one-letter words, acronyms and other scripts", () => {
    expect(words("a NASA আমার Wörter don't")).toEqual(["Wörter", "don't"]);
  });
});
