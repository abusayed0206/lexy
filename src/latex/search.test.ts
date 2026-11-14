import { describe, expect, it } from "vitest";
import { InvalidPattern, MAX_HITS, replaceIn, searchProject, type SearchOptions } from "./search";

const plain: SearchOptions = { matchCase: false, wholeWord: false, regex: false };
const texts = new Map([
  ["main.tex", "Intro text\nThe intro.\nintroduction"],
  ["chapters\\two.tex", "No match here"],
  ["refs.bib", "@book{intro,}"],
]);

describe("searchProject", () => {
  it("groups hits by file with line numbers and highlighted previews", () => {
    const { results, truncated } = searchProject(texts, "intro", plain);
    expect(truncated).toBe(false);
    expect(results.map((file) => [file.file, file.hits.map((hit) => hit.line)])).toEqual([
      ["main.tex", [1, 2, 3]],
      ["refs.bib", [1]],
    ]);
    const hit = results[0].hits[1];
    expect(hit.preview.slice(hit.previewFrom, hit.previewTo)).toBe("intro");
  });

  it("supports match case and whole word", () => {
    expect(searchProject(texts, "Intro", { ...plain, matchCase: true }).results[0].hits).toHaveLength(1);
    expect(searchProject(texts, "intro", { ...plain, wholeWord: true }).results.map((f) => f.hits.length)).toEqual([2, 1]);
  });

  it("supports regular expressions and reports invalid ones", () => {
    expect(searchProject(texts, "intro\\w+", { ...plain, regex: true }).results[0].hits.map((h) => h.line)).toEqual([3]);
    expect(() => searchProject(texts, "(", { ...plain, regex: true })).toThrow(InvalidPattern);
  });

  it("escapes special characters when not in regex mode", () => {
    expect(searchProject(new Map([["a.tex", "a.b axb \\cite{x}"]]), "\\cite{", plain).results[0].hits).toHaveLength(1);
    expect(searchProject(new Map([["a.tex", "a.b axb"]]), "a.b", plain).results[0].hits).toHaveLength(1);
  });

  it("stops at the hit limit and survives empty matches", () => {
    const many = new Map([["a.tex", "x".repeat(MAX_HITS + 10)]]);
    const result = searchProject(many, "x", plain);
    expect(result.truncated).toBe(true);
    expect(result.results[0].hits).toHaveLength(MAX_HITS);
    expect(searchProject(new Map([["a.tex", "ab"]]), "^", { ...plain, regex: true }).results).toEqual([]);
  });

  it("returns nothing for an empty query", () => {
    expect(searchProject(texts, "", plain).results).toEqual([]);
  });
});

describe("replaceIn", () => {
  it("replaces every match and counts them", () => {
    expect(replaceIn("cat Cat cat", "cat", plain, "dog")).toEqual({ text: "dog dog dog", count: 3 });
    expect(replaceIn("cat Cat", "cat", { ...plain, matchCase: true }, "dog")).toEqual({ text: "dog Cat", count: 1 });
  });

  it("expands groups in regex mode and keeps $ literal otherwise", () => {
    expect(replaceIn("a1 b2", "([a-z])(\\d)", { ...plain, regex: true }, "$2$1").text).toBe("1a 2b");
    expect(replaceIn("price", "price", plain, "$5").text).toBe("$5");
  });

  it("leaves text without matches unchanged", () => {
    expect(replaceIn("abc", "x", plain, "y")).toEqual({ text: "abc", count: 0 });
  });
});
