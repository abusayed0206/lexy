import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { closeOnEnter, findMatchingEnd, latexEnvironments } from "./environments";

describe("closeOnEnter", () => {
  it("adds the matching \\end with an indented line for the cursor", () => {
    const doc = "  \\begin{itemize}";
    expect(closeOnEnter(doc, doc.length)).toEqual({ insert: "\n    \n  \\end{itemize}", cursor: doc.length + 5 });
  });

  it("handles arguments after the name", () => {
    const doc = "\\begin{tabular}{ll}";
    expect(closeOnEnter(doc, doc.length)?.insert).toBe("\n  \n\\end{tabular}");
  });

  it("does nothing when the environment is already closed or text follows the cursor", () => {
    expect(closeOnEnter("\\begin{center}\nx\n\\end{center}", 14)).toBeNull();
    expect(closeOnEnter("\\begin{center} more", 14)).toBeNull();
    expect(closeOnEnter("% \\begin{center}", 16)).toBeNull();
  });

  it("closes an inner environment even when an outer one of the same name is closed", () => {
    const doc = "\\begin{itemize}\n\\begin{itemize}\n\\end{itemize}";
    // The first begin is matched by the end; the second (cursor) one is not... and vice versa: only one end exists.
    expect(closeOnEnter(doc, "\\begin{itemize}\n\\begin{itemize}".length)).toBeNull();
    expect(closeOnEnter(doc, "\\begin{itemize}".length)).not.toBeNull();
  });
});

describe("findMatchingEnd", () => {
  it("skips nested environments of the same name", () => {
    const doc = "\\begin{a}\\begin{a}\\end{a}\\end{a}";
    expect(findMatchingEnd(doc, 9, "a")).toEqual({ from: 30, to: 31 });
  });
});

describe("keeping \\begin and \\end names in sync", () => {
  const state = (doc: string) => EditorState.create({ doc, extensions: [history(), latexEnvironments] });

  it("renames the end when the begin name is edited, as one undo step", () => {
    let s = state("\\begin{itemize}\n\\item x\n\\end{itemize}");
    const tr = s.update({ changes: { from: 7, to: 14, insert: "enumerate" }, userEvent: "input.type" });
    s = tr.state;
    expect(s.doc.toString()).toBe("\\begin{enumerate}\n\\item x\n\\end{enumerate}");
    let undone = s;
    undo({ state: s, dispatch: (t) => (undone = t.state) });
    expect(undone.doc.toString()).toBe("\\begin{itemize}\n\\item x\n\\end{itemize}");
  });

  it("follows single-character typing and deletion", () => {
    let s = state("\\begin{center}\\end{center}");
    s = s.update({ changes: { from: 13, insert: "s" }, userEvent: "input.type" }).state;
    expect(s.doc.toString()).toBe("\\begin{centers}\\end{centers}");
    s = s.update({ changes: { from: 13, to: 14 }, userEvent: "delete.backward" }).state;
    expect(s.doc.toString()).toBe("\\begin{center}\\end{center}");
  });

  it("leaves programmatic edits and text outside the name alone", () => {
    let s = state("\\begin{center}\\end{center}");
    s = s.update({ changes: { from: 7, to: 13, insert: "x" }, userEvent: "input.lexy" }).state;
    expect(s.doc.toString()).toBe("\\begin{x}\\end{center}");
    s = state("ab \\begin{center}\\end{center}");
    s = s.update({ changes: { from: 0, insert: "z" }, userEvent: "input.type" }).state;
    expect(s.doc.toString()).toBe("zab \\begin{center}\\end{center}");
  });
});
