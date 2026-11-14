import { describe, expect, it } from "vitest";
import { annotate, mathAt, proseOnly, readableRanges } from "./readable";

const prose = (text: string) =>
  readableRanges(text)
    .text.map((range) => text.slice(range.from, range.to))
    .join("|");

describe("readableRanges", () => {
  it("keeps prose and drops command names, braces and comments", () => {
    expect(prose("Hello \\textbf{bold} world % a comment\nnext")).toBe("Hello |bold| world |\nnext");
  });

  it("skips the arguments of reference, citation, label, url and package commands", () => {
    const text = "See \\ref{sec:intro}, \\cite[p.~2]{knuth84,lamport} and \\url{https://x.org}.\\label{a}\\usepackage[utf8]{inputenc}";
    expect(prose(text)).toBe("See |, | and |.");
  });

  it("keeps the readable argument of href and textcolor", () => {
    expect(prose("\\href{https://x.org}{the site} \\textcolor{red}{warm}")).toBe("the site| |warm");
  });

  it("finds inline and display math with their inner text", () => {
    const text = "a $x^2$ b \\[y\\] c $$z$$ d \\(w\\)";
    const math = readableRanges(text).math;
    expect(math.map((m) => text.slice(m.innerFrom, m.innerTo))).toEqual(["x^2", "y", "z", "w"]);
    expect(math.map((m) => m.display)).toEqual([false, true, true, false]);
    expect(prose(text)).toBe("a | b | c | d ");
  });

  it("treats math environments as math and verbatim environments as markup", () => {
    const text = "x\\begin{align}a&=b\\end{align}y\\begin{verbatim}teh code\\end{verbatim}z";
    const ranges = readableRanges(text);
    expect(ranges.math).toHaveLength(1);
    expect(text.slice(ranges.math[0].innerFrom, ranges.math[0].innerTo)).toBe("a&=b");
    expect(prose(text)).toBe("x|y|z");
  });

  it("does not end math at an escaped dollar and keeps escaped percent signs out of comments", () => {
    const text = "cost $5\\$ + 1$ is 10\\% off";
    expect(readableRanges(text).math).toHaveLength(1);
    expect(prose(text)).toBe("cost | is 10| off");
  });

  it("skips tabular column specs but keeps cell text", () => {
    expect(prose("\\begin{tabular}{l|c}Name & Age\\\\\\end{tabular}")).toBe("Name | Age");
  });

  it("covers the whole text without overlaps", () => {
    const text = "\\section{Intro} Text $a$ % c\n\\begin{equation}b\\end{equation}";
    const r = readableRanges(text);
    const spans = [...r.text, ...r.math, ...r.markup].sort((a, b) => a.from - b.from);
    let at = 0;
    for (const span of spans) {
      expect(span.from).toBe(at);
      at = span.to;
    }
    expect(at).toBe(text.length);
  });
});

describe("mathAt, annotate, proseOnly", () => {
  it("finds the math under a position", () => {
    const text = "a $\\frac{1}{2}$ b";
    expect(mathAt(text, 5)?.innerFrom).toBe(3);
    expect(mathAt(text, 0)).toBeNull();
  });

  it("annotates prose as text, math as interpretable markup", () => {
    expect(annotate("Hi $x$ \\emph{you}")).toEqual([
      { text: "Hi " },
      { markup: "$x$", interpretAs: "x" },
      { text: " " },
      { markup: "\\emph{" },
      { text: "you" },
      { markup: "}" },
    ]);
  });

  it("blanks everything but prose and keeps line breaks", () => {
    expect(proseOnly("a \\b{c}\n$d$")).toBe("a    c \n   ");
  });
});
