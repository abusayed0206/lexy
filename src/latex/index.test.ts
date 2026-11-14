import { describe, expect, it } from "vitest";
import { buildIndex, plainTitle, stripComments, type IndexCache } from "./index";

const project = (files: Record<string, string>) => new Map(Object.entries(files));

const MAIN = [
  "\\documentclass{book}",
  "\\newcommand{\\R}{\\mathbb{R}}",
  "\\newcommand\\vect[1]{\\mathbf{#1}}",
  "\\DeclareMathOperator{\\argmax}{arg\\,max}",
  "\\begin{document}",
  "\\chapter{Start}\\label{ch:start}",
  "\\input{chapters/one}",
  "% \\section{Commented out}",
  "\\include{chapters/two.tex}",
  "\\end{document}",
].join("\n");

const ONE = [
  "\\section{Intro to \\emph{things}}",
  "\\label{sec:intro}",
  "\\begin{figure}",
  "\\includegraphics{a}",
  "\\caption{A \\textbf{nice} plot}\\label{fig:plot}",
  "\\end{figure}",
  "\\subsection*{Details}",
].join("\n");

const TWO = ["\\section{Second}", "\\begin{table}\\end{table}", "\\label{sec:intro}"].join("\n");

const BIB = `@article{knuth84,
  author = {Donald E. Knuth},
  title = "Literate {P}rogramming",
  year = 1984,
}
@comment{ignored, x}
@book{lamport, title={\\LaTeX: A Document Preparation System}, author={Leslie Lamport}, date={1994-01-01}}`;

describe("buildIndex", () => {
  const index = buildIndex(
    project({ "main.tex": MAIN, "chapters\\one.tex": ONE, "chapters\\two.tex": TWO, "refs.bib": BIB, "orphan.tex": "\\section{Unused}" }),
    "main.tex",
  );

  it("follows input and include from the main document in order", () => {
    expect(index.outline.map((entry) => [entry.kind, entry.title, entry.file, entry.line, entry.depth])).toEqual([
      ["chapter", "Start", "main.tex", 6, 1],
      ["section", "Intro to things", "chapters\\one.tex", 1, 2],
      ["figure", "A nice plot", "chapters\\one.tex", 3, 3],
      ["subsection", "Details", "chapters\\one.tex", 7, 3],
      ["section", "Second", "chapters\\two.tex", 1, 2],
      ["table", "(no caption)", "chapters\\two.tex", 2, 3],
    ]);
    expect(index.documentFiles).toEqual(["main.tex", "chapters\\one.tex", "chapters\\two.tex"]);
  });

  it("collects macros with argument counts", () => {
    expect(index.macros.map((m) => [m.name, m.args])).toEqual([
      ["R", 0],
      ["vect", 1],
      ["argmax", 0],
    ]);
  });

  it("gives labels context and flags duplicates", () => {
    const labels = Object.fromEntries(index.labels.map((l) => [`${l.file}:${l.key}`, l]));
    expect(labels["main.tex:ch:start"].context).toBe("Start");
    expect(labels["chapters\\one.tex:fig:plot"].context).toBe("A nice plot");
    expect(labels["chapters\\one.tex:sec:intro"].duplicate).toBe(true);
    expect(labels["main.tex:ch:start"].duplicate).toBe(false);
  });

  it("parses bibliography entries with braces, quotes and bare values", () => {
    expect(index.bibEntries.map((e) => [e.key, e.type, e.title, e.author, e.year, e.line])).toEqual([
      ["knuth84", "article", "Literate Programming", "Donald E. Knuth", "1984", 1],
      ["lamport", "book", ": A Document Preparation System", "Leslie Lamport", "1994", 7],
    ]);
  });

  it("does not loop on files that include each other", () => {
    const loop = buildIndex(project({ "a.tex": "\\section{A}\\input{b}", "b.tex": "\\section{B}\\input{a}" }), "a.tex");
    expect(loop.outline.map((e) => e.title)).toEqual(["A", "B"]);
  });

  it("reuses the cached parse for unchanged files", () => {
    const cache: IndexCache = new Map();
    buildIndex(project({ "a.tex": "\\section{A}" }), "a.tex", cache);
    const first = cache.get("a.tex");
    buildIndex(project({ "a.tex": "\\section{A}", "b.tex": "x" }), "a.tex", cache);
    expect(cache.get("a.tex")).toBe(first);
    buildIndex(project({ "a.tex": "\\section{B}" }), "a.tex", cache);
    expect(cache.get("a.tex")).not.toBe(first);
    expect(cache.has("b.tex")).toBe(false);
  });

  it("has an empty outline without a main document", () => {
    expect(buildIndex(project({ "a.tex": "\\section{A}" }), null).outline).toEqual([]);
  });
});

describe("helpers", () => {
  it("blanks comments but not escaped percent signs", () => {
    expect(stripComments("50\\% done % note\nnext")).toBe("50\\% done       \nnext");
  });

  it("turns LaTeX into a plain title", () => {
    expect(plainTitle("The \\emph{big}~idea\\footnote{x}")).toBe("The big idea");
  });
});
