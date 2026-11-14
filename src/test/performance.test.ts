/**
 * Spec 007 performance targets on a generated 500-file, ~1,000-page project (T087):
 * suggestions < 100 ms (SC-001), project search < 1 s (SC-005), index refresh < 2 s.
 * Timings are printed for the TRACKER Verification Log.
 */
import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { latexCompletions } from "../latex/completions";
import { buildIndex, type IndexCache } from "../latex/index";
import { searchProject } from "../latex/search";
import { projectWordCount, type WordCountCache } from "../latex/wordCount";

const FILES = 500;
const PARAGRAPH =
  "This paragraph describes the measured samples and the method we used, with a reference to Section~\\ref{sec:intro} " +
  "and a citation \\cite{key12}. The value $x^2 + y^2 = r^2$ holds for every point on the circle, as \\textbf{expected}.\n\n";

/** ~2 pages per chapter file: 1,000 pages over 500 files. */
function project(): Map<string, string> {
  const texts = new Map<string, string>();
  const inputs: string[] = [];
  for (let i = 0; i < FILES - 2; i++) {
    const name = `chapters\\c${i}.tex`;
    inputs.push(`\\input{chapters/c${i}}`);
    let body = `\\section{Chapter ${i}}\\label{sec:c${i}}\n`;
    for (let s = 0; s < 4; s++) body += `\\subsection{Part ${s}}\\label{sec:c${i}s${s}}\n${PARAGRAPH.repeat(6)}`;
    body += `\\begin{figure}\\caption{Figure ${i}}\\label{fig:${i}}\\end{figure}\n`;
    texts.set(name, body);
  }
  let bib = "";
  for (let k = 0; k < 2000; k++) bib += `@article{key${k}, author={Author ${k} and Other}, title={Title number ${k}}, year={${1950 + (k % 70)}}}\n`;
  texts.set("refs.bib", bib);
  texts.set("main.tex", `\\documentclass{book}\n\\newcommand{\\R}{\\mathbb{R}}\n\\begin{document}\n\\section{Intro}\\label{sec:intro}\n${inputs.join("\n")}\n\\bibliography{refs}\n\\end{document}\n`);
  return texts;
}

function time<T>(run: () => T): { ms: number; result: T } {
  const start = performance.now();
  const result = run();
  return { ms: performance.now() - start, result };
}

describe("performance on a 500-file project", () => {
  const texts = project();
  const totalBytes = [...texts.values()].reduce((sum, text) => sum + text.length, 0);
  const cache: IndexCache = new Map();
  const cold = time(() => buildIndex(texts, "main.tex", cache));
  const index = cold.result;

  it("indexes the whole project (cold) and refreshes after an edit within 2 s", () => {
    const edited = new Map(texts);
    edited.set("chapters\\c10.tex", `${texts.get("chapters\\c10.tex")}\\section{New}\n`);
    const warm = time(() => buildIndex(edited, "main.tex", cache));
    console.log(`index: ${texts.size} files, ${(totalBytes / 1e6).toFixed(1)} MB; cold ${cold.ms.toFixed(0)} ms, after one edit ${warm.ms.toFixed(0)} ms`);
    expect(index.outline.length).toBeGreaterThan(2500);
    expect(index.labels.length).toBeGreaterThan(2500);
    expect(index.bibEntries).toHaveLength(2000);
    expect(warm.result.outline.length).toBe(index.outline.length + 1);
    expect(cold.ms).toBeLessThan(2000);
    expect(warm.ms).toBeLessThan(2000);
  });

  it("answers suggestions within 100 ms (SC-001)", () => {
    const source = latexCompletions(() => index);
    const ask = (doc: string) => {
      const state = EditorState.create({ doc });
      return time(() => source(new CompletionContext(state, doc.length, false)));
    };
    const command = ask("Text \\sec");
    const label = ask("See \\ref{sec:c4");
    const cite = ask("As in \\cite{key1");
    console.log(`suggestions: command ${command.ms.toFixed(1)} ms, label ${label.ms.toFixed(1)} ms, citation ${cite.ms.toFixed(1)} ms`);
    for (const { ms, result } of [command, label, cite]) {
      expect(result).not.toBeNull();
      expect(ms).toBeLessThan(100);
    }
  });

  it("searches all files within 1 s (SC-005)", () => {
    const plain = time(() => searchProject(texts, "Chapter ", { matchCase: true, wholeWord: false, regex: false }));
    const capped = time(() => searchProject(texts, "measured samples", { matchCase: false, wholeWord: false, regex: false }));
    const regex = time(() => searchProject(texts, "x\\^2 \\+ y", { matchCase: true, wholeWord: false, regex: true }));
    console.log(`search: plain ${plain.ms.toFixed(0)} ms (${plain.result.results.length} files), common phrase ${capped.ms.toFixed(0)} ms (capped), regex ${regex.ms.toFixed(0)} ms`);
    expect(plain.result.results.length).toBe(FILES - 2); // one heading per chapter file
    expect(capped.result.truncated).toBe(true); // 24 hits per file stop at the 5,000-hit cap
    expect(capped.ms).toBeLessThan(1000);
    expect(plain.ms).toBeLessThan(1000);
    expect(regex.ms).toBeLessThan(1000);
  });

  it("counts the project's words within 2 s", () => {
    const words: WordCountCache = new Map();
    const counted = time(() => projectWordCount(index.documentFiles, texts, words));
    console.log(`word count: ${counted.result} words in ${counted.ms.toFixed(0)} ms`);
    expect(counted.result).toBeGreaterThan(100_000);
    expect(counted.ms).toBeLessThan(2000);
  });
});
