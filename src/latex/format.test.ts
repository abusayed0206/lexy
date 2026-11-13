import { describe, expect, it } from "vitest";
import { footnote, headingLevelAt, insertBlock, pageBreak, replaceWith, setHeading, toList, wrap, type TextEdit } from "./format";

function apply(text: string, edit: TextEdit) {
  const result = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  // Selection offsets are in the old text up to edit.from; afterwards they're in the new text.
  return { result, selected: result.slice(edit.selectFrom, edit.selectTo), cursor: edit.selectFrom };
}

describe("wrap", () => {
  it("wraps the selection and keeps it selected", () => {
    const { result, selected } = apply("make this bold", wrap("make this bold", { from: 5, to: 9 }, "textbf"));
    expect(result).toBe("make \\textbf{this} bold");
    expect(selected).toBe("this");
  });

  it("inserts an empty command with the cursor inside", () => {
    const edit = wrap("ab", { from: 1, to: 1 }, "textit");
    const { result, cursor } = apply("ab", edit);
    expect(result).toBe("a\\textit{}b");
    expect(result.slice(0, cursor)).toBe("a\\textit{");
  });

  it("toggles off when the selection is already wrapped", () => {
    const text = "x \\underline{word} y";
    const { result, selected } = apply(text, wrap(text, { from: 13, to: 17 }, "underline"));
    expect(result).toBe("x word y");
    expect(selected).toBe("word");
  });
});

describe("setHeading", () => {
  const text = "first\nIntroduction\nlast";

  it.each([
    [1, "\\section{Introduction}"],
    [2, "\\subsection{Introduction}"],
    [3, "\\subsubsection{Introduction}"],
  ] as const)("level %s", (level, expected) => {
    const { result, selected } = apply(text, setHeading(text, { from: 8, to: 8 }, level));
    expect(result).toBe(`first\n${expected}\nlast`);
    expect(selected).toBe("Introduction");
  });

  it("switches levels and back to Normal without nesting", () => {
    const heading = "\\subsection{Intro}";
    expect(apply(heading, setHeading(heading, { from: 3, to: 3 }, 1)).result).toBe("\\section{Intro}");
    expect(apply(heading, setHeading(heading, { from: 3, to: 3 }, 0)).result).toBe("Intro");
    expect(apply("\\section*{Intro}", setHeading("\\section*{Intro}", { from: 0, to: 0 }, 3)).result).toBe("\\subsubsection{Intro}");
  });

  it("reports the heading level at the cursor", () => {
    expect(headingLevelAt("a\n\\subsection{b}\nc", 4)).toBe(2);
    expect(headingLevelAt("plain", 2)).toBe(0);
  });
});

describe("toList", () => {
  it("turns selected lines into items, skipping blanks", () => {
    const text = "one\n\ntwo\nthree";
    const { result } = apply(text, toList(text, { from: 0, to: text.length }, "itemize"));
    expect(result).toBe("\\begin{itemize}\n  \\item one\n  \\item two\n  \\item three\n\\end{itemize}");
  });

  it("does not double existing \\item prefixes", () => {
    const text = "\\item a\n\\item b";
    expect(apply(text, toList(text, { from: 0, to: text.length }, "enumerate")).result).toBe(
      "\\begin{enumerate}\n  \\item a\n  \\item b\n\\end{enumerate}",
    );
  });

  it("uses only the current line when nothing is selected, cursor after the item", () => {
    const text = "keep\nitem here\nkeep";
    const { result, cursor } = apply(text, toList(text, { from: 7, to: 7 }, "itemize"));
    expect(result).toBe("keep\n\\begin{itemize}\n  \\item item here\n\\end{itemize}\nkeep");
    expect(result.slice(0, cursor).endsWith("\\item item here")).toBe(true);
  });

  it("makes an empty item on a blank line", () => {
    expect(apply("", toList("", { from: 0, to: 0 }, "itemize")).result).toBe("\\begin{itemize}\n  \\item \n\\end{itemize}");
  });

  it("ignores a trailing newline in the selection", () => {
    const text = "a\nb\nc";
    expect(apply(text, toList(text, { from: 0, to: 4 }, "itemize")).result).toBe("\\begin{itemize}\n  \\item a\n  \\item b\n\\end{itemize}\nc");
  });
});

describe("pageBreak and blocks", () => {
  it("puts \\newpage on its own line mid-line", () => {
    expect(apply("ab", pageBreak("ab", { from: 1, to: 1 })).result).toBe("a\n\\newpage\nb");
  });

  it("does not add blank lines at line boundaries", () => {
    expect(apply("a\nb", pageBreak("a\nb", { from: 2, to: 2 })).result).toBe("a\n\\newpage\nb");
  });

  it("insertBlock places the cursor inside the block", () => {
    const { result, cursor } = apply("xy", insertBlock("xy", { from: 1, to: 1 }, "BLOCK", 2));
    expect(result).toBe("x\nBLOCK\ny");
    expect(result.slice(0, cursor)).toBe("x\nBL");
  });

  it("footnote wraps the selection", () => {
    expect(apply("see this", footnote("see this", { from: 4, to: 8 })).result).toBe("see \\footnote{this}");
  });

  it("replaceWith puts the cursor after the replacement", () => {
    const { result, cursor } = apply("a $x$ b", replaceWith({ from: 2, to: 5 }, "\\(y\\)"));
    expect(result).toBe("a \\(y\\) b");
    expect(result.slice(0, cursor)).toBe("a \\(y\\)");
  });
});
