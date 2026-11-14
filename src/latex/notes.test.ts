import { describe, expect, it } from "vitest";
import { escapeLatex, injectTodos, newNote, parseNotes, reanchor, serializeNotes, withTodonotes, type Note } from "./notes";

const TEXT = "We measured 42 samples. The number of samples is small.";
const note = (from: number, to: number, extra: Partial<Note> = {}): Note => ({ ...newNote("main.tex", from, to, TEXT, "check this", new Date(0)), ...extra });

describe("notes", () => {
  it("keeps the quoted text and a trimmed body", () => {
    const made = newNote("main.tex", 12, 22, TEXT, "  check this  ", new Date(0));
    expect(made).toMatchObject({ file: "main.tex", from: 12, to: 22, quote: "42 samples", body: "check this", state: "open", created: "1970-01-01T00:00:00.000Z" });
  });

  it("round-trips through notes.json and drops malformed entries", () => {
    const notes = [note(12, 22)];
    expect(parseNotes(serializeNotes(notes))).toEqual(notes);
    expect(parseNotes('{"version":1,"notes":[{"id":1},{"id":"x","file":"a","from":5,"to":2,"quote":"","body":"","state":"open"}]}')).toEqual([]);
    expect(parseNotes("not json")).toEqual([]);
  });

  it("re-anchors to the nearest copy of the quote after edits, or detaches", () => {
    const n = note(12, 22);
    expect(reanchor(n, TEXT)).toMatchObject({ from: 12, to: 22, state: "open" });
    const edited = `Intro. ${TEXT}`;
    expect(reanchor(n, edited)).toMatchObject({ from: 19, to: 29, state: "open" });
    expect(reanchor(n, "All gone.")).toMatchObject({ state: "detached" });
    expect(reanchor({ ...n, state: "detached" }, TEXT).state).toBe("open");
    expect(reanchor({ ...n, state: "resolved" }, edited).state).toBe("resolved");
  });

  it("injects \\todo after every open note, escaping LaTeX characters", () => {
    const notes = [note(12, 22, { body: "50% & $x$" }), note(28, 34, { body: "second" }), note(0, 2, { state: "resolved" })];
    expect(injectTodos(TEXT, notes)).toBe("We measured 42 samples\\todo{50\\% \\& \\$x\\$}. The number\\todo{second} of samples is small.");
    expect(escapeLatex("a\\b {c}\nd")).toBe("a\\textbackslash{}b \\{c\\} d");
  });

  it("adds todonotes once", () => {
    const doc = "\\documentclass{article}\n\\begin{document}";
    const once = withTodonotes(doc);
    expect(once).toBe("\\documentclass{article}\n\\usepackage{todonotes}\n\\begin{document}");
    expect(withTodonotes(once)).toBe(once);
  });
});
