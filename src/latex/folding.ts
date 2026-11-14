/**
 * Folding for LaTeX (spec 007 R11). The legacy `stex` mode has no syntax tree, so ranges come
 * from the text: a heading folds to the line before the next heading of the same or a higher
 * level (or `\end{document}`), and a `\begin{x}` line folds to its matching `\end{x}`.
 */
import { foldService } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { findMatchingEnd } from "./environments";

const LEVEL: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const HEADING = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const BEGIN = /\\begin\s*\{([^}\n]+)\}/;

/** The fold range starting on the line at `lineStart`, or null. Offsets are in `doc`. */
export function latexFoldRange(doc: string, lineStart: number, lineEnd: number): { from: number; to: number } | null {
  const line = doc.slice(lineStart, lineEnd);
  if (/^\s*%/.test(line)) return null;
  const heading = HEADING.exec(line);
  if (heading) {
    const level = LEVEL[heading[1]];
    let pos = lineEnd + 1;
    let lastEnd = lineEnd;
    while (pos <= doc.length) {
      const next = doc.indexOf("\n", pos);
      const end = next < 0 ? doc.length : next;
      const text = doc.slice(pos, end);
      const other = HEADING.exec(text);
      if ((other && LEVEL[other[1]] <= level) || /^\s*\\end\s*\{document\}/.test(text)) break;
      if (text.trim()) lastEnd = end;
      if (next < 0) break;
      pos = next + 1;
    }
    return lastEnd > lineEnd ? { from: lineEnd, to: lastEnd } : null;
  }
  const begin = BEGIN.exec(line);
  if (begin && begin[1] !== "document") {
    const afterBegin = lineStart + begin.index + begin[0].length;
    const end = findMatchingEnd(doc, afterBegin, begin[1]);
    if (!end) return null;
    // Fold from the end of the begin line to just before `\end` (which stays visible).
    const endLineStart = doc.lastIndexOf("\n", end.from) ;
    return endLineStart > lineEnd ? { from: lineEnd, to: endLineStart } : null;
  }
  return null;
}

/** The fold gutter asks once per visible line; the document string is built once per version. */
const docText = new WeakMap<EditorState["doc"], string>();
function textOf(state: EditorState): string {
  let text = docText.get(state.doc);
  if (text === undefined) docText.set(state.doc, (text = state.doc.toString()));
  return text;
}

export const latexFolding = foldService.of((state: EditorState, lineStart: number, lineEnd: number) => {
  const line = state.doc.sliceString(lineStart, lineEnd);
  // Most lines can't start a fold; skip building the whole text for them.
  if (!line.includes("\\")) return null;
  return latexFoldRange(textOf(state), lineStart, lineEnd);
});
