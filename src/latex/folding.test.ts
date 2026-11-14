import { describe, expect, it } from "vitest";
import { latexFoldRange } from "./folding";

/** Fold range for the 1-based `line` of `doc`, as the folded text. */
function fold(doc: string, line: number): string | null {
  const lines = doc.split("\n");
  const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
  const range = latexFoldRange(doc, start, start + lines[line - 1].length);
  return range ? doc.slice(range.from, range.to) : null;
}

const DOC = [
  "\\begin{document}", // 1
  "\\section{One}", // 2
  "Text one.", // 3
  "\\subsection{One A}", // 4
  "Text A.", // 5
  "", // 6
  "\\section{Two}", // 7
  "\\begin{itemize}", // 8
  "  \\item x", // 9
  "\\end{itemize}", // 10
  "\\end{document}", // 11
].join("\n");

describe("latexFoldRange", () => {
  it("folds a section up to the next heading of the same level, skipping trailing blank lines", () => {
    expect(fold(DOC, 2)).toBe("\nText one.\n\\subsection{One A}\nText A.");
  });

  it("folds a subsection up to the next higher heading", () => {
    expect(fold(DOC, 4)).toBe("\nText A.");
  });

  it("stops at \\end{document}", () => {
    expect(fold(DOC, 7)).toBe("\n\\begin{itemize}\n  \\item x\n\\end{itemize}");
  });

  it("folds an environment to just before its \\end line", () => {
    expect(fold(DOC, 8)).toBe("\n  \\item x");
  });

  it("does not fold the document environment, plain lines or comments", () => {
    expect(fold(DOC, 1)).toBeNull();
    expect(fold(DOC, 3)).toBeNull();
    expect(fold("% \\section{x}\ny", 1)).toBeNull();
  });

  it("does not fold a heading with nothing under it", () => {
    expect(fold("\\section{A}\n\\section{B}", 1)).toBeNull();
  });
});
