import { describe, expect, it } from "vitest";
import { findMatches, matchRects, nearestMatch, normalizeQuery, pageText, type TextItemLike } from "./find";

const item = (str: string, x = 0, y = 700, width = str.length * 10, hasEOL = false): TextItemLike => ({ str, width, height: 12, transform: [12, 0, 0, 12, x, y], hasEOL });

describe("pageText", () => {
  it("joins items, folds case and collapses whitespace and line ends", () => {
    const page = pageText([item("Hello  "), item("World", 0, 700, 50, true), item("Next\tline")]);
    expect(page.text).toBe("hello world next line");
    expect(page.map).toHaveLength(page.text.length);
    expect(page.map[6]).toEqual({ item: 1, offset: 0 });
  });

  it("keeps offsets one-to-one when folding would change the length", () => {
    expect(pageText([item("İx")]).text).toHaveLength(2);
  });
});

describe("findMatches", () => {
  const pages = [pageText([item("Lexy is "), item("great. ", 80), item("LEXY", 150, 700, 40, true)]), pageText([item("no match here")]), pageText([item("lexy")])];

  it("finds every match, ignoring case, across items and pages", () => {
    expect(findMatches(pages, "lexy")).toEqual([
      { page: 0, start: 0, end: 4 },
      { page: 0, start: 15, end: 19 },
      { page: 2, start: 0, end: 4 },
    ]);
  });

  it("matches across a line break and collapses spaces in the query", () => {
    const page = pageText([item("the quick", 0, 700, 90, true), item("brown fox")]);
    expect(findMatches([page], "quick   BROWN")).toEqual([{ page: 0, start: 4, end: 15 }]);
  });

  it("returns nothing for an empty query or no match", () => {
    expect(findMatches(pages, "   ")).toEqual([]);
    expect(findMatches(pages, "absent")).toEqual([]);
    expect(normalizeQuery("  A  b ")).toBe("a b");
  });
});

describe("matchRects", () => {
  it("splits an item proportionally for a match in its middle", () => {
    const items = [item("abcdefghij", 100, 500, 100)];
    const page = pageText(items);
    const [match] = findMatches([page], "def");
    expect(matchRects(match, items, page)).toEqual([{ x: 130, y: 500, width: 30, height: 12 }]);
  });

  it("gives one box per item and skips the space added at a line end", () => {
    const items = [item("one", 0, 700, 30, true), item("two", 0, 680, 30)];
    const page = pageText(items);
    const [match] = findMatches([page], "one two");
    expect(matchRects(match, items, page)).toEqual([
      { x: 0, y: 700, width: 30, height: 12 },
      { x: 0, y: 680, width: 30, height: 12 },
    ]);
  });
});

describe("nearestMatch", () => {
  const hits = [
    { page: 0, top: 100 },
    { page: 0, top: 400 },
    { page: 2, top: 50 },
  ];
  it("picks the first hit at or after a position and wraps to the start", () => {
    expect(nearestMatch(hits, 0, 200)).toBe(1);
    expect(nearestMatch(hits, 1, 0)).toBe(2);
    expect(nearestMatch(hits, 3, 0)).toBe(0);
  });
});
