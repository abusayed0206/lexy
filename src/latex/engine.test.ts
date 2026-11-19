import { describe, expect, it } from "vitest";
import { engineEdit, readEngine } from "./engine";
import type { TextEdit } from "./format";
import { XELATEX_MARKER } from "./settings";

const apply = (text: string, edit: TextEdit | null) => (edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : text);
const DOC = "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n";

describe("readEngine", () => {
  it.each([
    ["% !TEX program = xelatex\n\\documentclass{article}", "xelatex"],
    ["%!TEX TS-program = lualatex", "lualatex"],
    ["  % !tex PROGRAM=XeLaTeX  ", "xelatex"],
    ["a\nb\nc\nd\n% !TEX program = xelatex", "xelatex"],
    ["% !TEX program = pdflatex", "pdflatex"],
  ])("reads the same lines as the compiler: %j", (text, choice) => {
    expect(readEngine(text).choice).toBe(choice);
  });

  it.each(["\\documentclass{article}", "% !TEX program = context", "a\nb\nc\nd\ne\n% !TEX program = xelatex", "% !TEX root = main.tex", "text % !TEX program = xelatex"])(
    "ignores non-markers: %j",
    (text) => {
      expect(readEngine(text)).toEqual({ choice: "auto", line: null, setByFont: false });
    },
  );

  it("knows the line written by the font settings", () => {
    expect(readEngine(`${XELATEX_MARKER}\n${DOC}`)).toEqual({ choice: "xelatex", line: 0, setByFont: true });
    expect(readEngine(`% !TEX TS-program = xelatex\n${DOC}`).setByFont).toBe(false);
  });
});

describe("engineEdit", () => {
  it("adds a line 1 when there is none", () => {
    expect(apply(DOC, engineEdit(DOC, "lualatex"))).toBe(`% !TEX TS-program = lualatex\n${DOC}`);
  });

  it("replaces an existing line in place, even on line 5", () => {
    const text = `% a\n% b\n% c\n% d\n% !TEX program = xelatex\n${DOC}`;
    expect(apply(text, engineEdit(text, "pdflatex"))).toBe(`% a\n% b\n% c\n% d\n% !TEX TS-program = pdflatex\n${DOC}`);
  });

  it("adds a new line 1 when the only marker is on line 6", () => {
    const text = `% a\n% b\n% c\n% d\n% e\n% !TEX program = xelatex\n${DOC}`;
    expect(apply(text, engineEdit(text, "lualatex")).startsWith("% !TEX TS-program = lualatex\n% a")).toBe(true);
  });

  it("Automatic removes the line, and does nothing without one", () => {
    expect(apply(`% !TEX TS-program = lualatex\n${DOC}`, engineEdit(`% !TEX TS-program = lualatex\n${DOC}`, "auto"))).toBe(DOC);
    expect(engineEdit(DOC, "auto")).toBeNull();
  });

  it("keeps CRLF line endings", () => {
    const text = DOC.replace(/\n/g, "\r\n");
    const added = apply(text, engineEdit(text, "xelatex"));
    expect(added).toBe(`% !TEX TS-program = xelatex\r\n${text}`);
    expect(apply(added, engineEdit(added, "pdflatex"))).toBe(`% !TEX TS-program = pdflatex\r\n${text}`);
    expect(apply(added, engineEdit(added, "auto"))).toBe(text);
  });

  it("choosing the current engine twice changes nothing", () => {
    const once = apply(DOC, engineEdit(DOC, "xelatex"));
    expect(engineEdit(once, "xelatex")).toBeNull();
  });

  it("rewrites the font's line in the menu's form when another engine is chosen", () => {
    const text = `${XELATEX_MARKER}\n${DOC}`;
    expect(apply(text, engineEdit(text, "lualatex"))).toBe(`% !TEX TS-program = lualatex\n${DOC}`);
  });
});
