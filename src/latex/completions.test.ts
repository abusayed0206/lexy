import { describe, expect, it } from "vitest";
import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { latexCompletions } from "./completions";
import { buildIndex } from "./index";

const index = buildIndex(
  new Map([
    ["main.tex", "\\newcommand{\\R}{\\mathbb{R}}\\newcommand{\\pair}[2]{(#1,#2)}\\begin{document}\\section{Intro}\\label{sec:intro}\\end{document}"],
    ["refs.bib", "@book{knuth84, author={Donald Knuth and Someone Else}, title={The TeXbook}, year=1984}\n@article{lamport94, author={Leslie Lamport}, title={LaTeX}, year=1994}"],
  ]),
  "main.tex",
);

function complete(doc: string, explicit = false): CompletionResult | null {
  const state = EditorState.create({ doc });
  const result = latexCompletions(() => index)(new CompletionContext(state, doc.length, explicit));
  return result instanceof Promise ? null : result;
}

const labels = (result: CompletionResult | null) => result?.options.map((option) => option.label) ?? [];

describe("latexCompletions", () => {
  it("suggests built-in and project commands after a backslash", () => {
    const result = complete("Text \\sec");
    expect(result!.from).toBe(5);
    expect(labels(result)).toEqual(expect.arrayContaining(["\\section", "\\R", "\\pair", "\\begin"]));
    const pair = result!.options.find((option) => option.label === "\\pair")!;
    expect(pair.detail).toBe("Defined in main.tex");
  });

  it("stays quiet on a lone backslash unless asked", () => {
    expect(complete("a \\")).toBeNull();
    expect(complete("a \\", true)).not.toBeNull();
  });

  it("suggests labels inside reference commands, with their context", () => {
    const result = complete("see \\ref{se");
    expect(result!.from).toBe(9);
    expect(result!.options).toEqual([expect.objectContaining({ label: "sec:intro", detail: "Intro" })]);
    expect(labels(complete("\\eqref{"))).toEqual(["sec:intro"]);
  });

  it("suggests bibliography keys inside citations, after the last comma", () => {
    const result = complete("\\citep[p.~3]{knuth84, la");
    expect(result!.from).toBe("\\citep[p.~3]{knuth84, ".length);
    expect(result!.options.map((o) => [o.label, o.detail, o.info])).toEqual([
      ["knuth84", "Donald Knuth · 1984", "The TeXbook"],
      ["lamport94", "Leslie Lamport · 1994", "LaTeX"],
    ]);
  });

  it("suggests environments inside \\begin{", () => {
    const result = complete("\\begin{ite");
    expect(result!.from).toBe(7);
    expect(labels(result)).toContain("itemize");
  });

  it("returns nothing in plain text", () => {
    expect(complete("plain words")).toBeNull();
  });
});
