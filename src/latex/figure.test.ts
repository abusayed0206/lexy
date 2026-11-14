import { describe, expect, it } from "vitest";
import { ensureGraphicx, figureBlock, insertFigure, isImage } from "./figure";
import { BLOCK_END, BLOCK_START } from "./settings";

const apply = (text: string, edit: { from: number; to: number; insert: string } | null) =>
  edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : text;

describe("figureBlock and insertFigure", () => {
  it("builds a figure with a forward-slash path and a label from the file name", () => {
    expect(figureBlock("figures\\My Plot.png").text).toBe(
      "\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figures/My Plot.png}\n  \\caption{Caption}\n  \\label{fig:my-plot}\n\\end{figure}\n",
    );
  });

  it("puts the figure on its own line and selects the caption", () => {
    const text = "Before text";
    const edit = insertFigure(text, 6, "figures/a.png");
    const result = apply(text, edit);
    expect(result.startsWith("Before\n\\begin{figure}")).toBe(true);
    expect(result.slice(edit.selectFrom, edit.selectTo)).toBe("Caption");
    const empty = insertFigure("x\n\ny", 2, "a.png");
    expect(empty.insert.startsWith("\\begin{figure}")).toBe(true);
  });

  it("knows image files", () => {
    expect(isImage("a.PNG")).toBe(true);
    expect(isImage("a.tex")).toBe(false);
  });
});

describe("ensureGraphicx", () => {
  it("adds one line after the class line", () => {
    const doc = "\\documentclass[11pt]{article}\n\\usepackage{amsmath}\n";
    expect(apply(doc, ensureGraphicx(doc))).toBe("\\documentclass[11pt]{article}\n\\usepackage{graphicx}\n\\usepackage{amsmath}\n");
  });

  it("goes after Lexy's settings block", () => {
    const doc = `\\documentclass{article}\n${BLOCK_START}\n\\usepackage{geometry}\n${BLOCK_END}\n\\begin{document}`;
    expect(apply(doc, ensureGraphicx(doc))).toBe(`\\documentclass{article}\n${BLOCK_START}\n\\usepackage{geometry}\n${BLOCK_END}\n\\usepackage{graphicx}\n\\begin{document}`);
  });

  it("does nothing when graphicx is already loaded", () => {
    expect(ensureGraphicx("\\documentclass{article}\n\\usepackage[draft]{xcolor,graphicx}\n")).toBeNull();
  });
});
