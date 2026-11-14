/**
 * `\begin{…}` / `\end{…}` pairs (spec 007 R3): Enter after an unclosed `\begin{name}` adds the
 * `\end{name}`, and renaming a `\begin` renames its `\end` in the same transaction (one undo step).
 */
import { EditorSelection, EditorState, Prec, type Text, type Transaction, type TransactionSpec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

const PAIR = /\\(begin|end)\s*\{([^}\n]*)\}/g;
const INDENT = "  ";

/** Offset range of the name in the `\end{name}` that closes the `\begin` ending at `after`, or null. */
export function findMatchingEnd(doc: string, after: number, name: string): { from: number; to: number } | null {
  PAIR.lastIndex = after;
  let depth = 0;
  for (let m = PAIR.exec(doc); m; m = PAIR.exec(doc)) {
    if (m[2] !== name) continue;
    if (m[1] === "begin") depth++;
    else if (depth === 0) {
      const nameFrom = m.index + m[0].indexOf("{") + 1;
      return { from: nameFrom, to: nameFrom + name.length };
    } else depth--;
  }
  return null;
}

/** The text to insert when Enter is pressed at `pos`, or null when the line has no unclosed `\begin`. */
export function closeOnEnter(doc: string, pos: number): { insert: string; cursor: number } | null {
  const lineStart = doc.lastIndexOf("\n", pos - 1) + 1;
  const lineEndAt = doc.indexOf("\n", pos);
  const rest = doc.slice(pos, lineEndAt < 0 ? doc.length : lineEndAt);
  if (rest.trim() !== "") return null;
  const before = doc.slice(lineStart, pos);
  const m = /\\begin\s*\{([^}\n]+)\}(?:\s*(?:\[[^\]\n]*\]|\{[^}\n]*\}))*\s*$/.exec(before);
  if (!m || /%/.test(before.slice(0, m.index))) return null;
  if (findMatchingEnd(doc, pos, m[1])) return null;
  const indent = /^\s*/.exec(before)![0];
  const inner = `\n${indent}${INDENT}`;
  return { insert: `${inner}\n${indent}\\end{${m[1]}}`, cursor: pos + inner.length };
}

function enterCommand(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1 || state.readOnly) return false;
  const result = closeOnEnter(state.doc.toString(), range.head);
  if (!result) return false;
  view.dispatch({
    changes: { from: range.head, to: state.doc.lineAt(range.head).to, insert: result.insert },
    selection: EditorSelection.cursor(result.cursor),
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

/** If `tr` edits only inside a `\begin{name}` name, the change that renames its `\end` to match. */
export function syncEndName(doc: Text, from: number, to: number, inserted: string): { from: number; to: number; insert: string } | null {
  const line = doc.lineAt(from);
  if (to > line.to) return null;
  PAIR.lastIndex = 0;
  for (let m = PAIR.exec(line.text); m; m = PAIR.exec(line.text)) {
    if (m[1] !== "begin") continue;
    const nameFrom = line.from + m.index + m[0].indexOf("{") + 1;
    const nameTo = nameFrom + m[2].length;
    if (from < nameFrom || to > nameTo) continue;
    const next = m[2].slice(0, from - nameFrom) + inserted + m[2].slice(to - nameFrom);
    if (next === m[2] || /[{}\s\\]/.test(next)) return null;
    const end = findMatchingEnd(doc.toString(), nameTo + 1, m[2]);
    return end ? { ...end, insert: next } : null;
  }
  return null;
}

const keepPairs = EditorState.transactionFilter.of((tr: Transaction): Transaction | readonly TransactionSpec[] => {
  if (!tr.docChanged || !(tr.isUserEvent("input") || tr.isUserEvent("delete")) || tr.isUserEvent("input.lexy")) return tr;
  const changes: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((from, to, _f, _t, text) => changes.push({ from, to, insert: text.toString() }));
  if (changes.length !== 1) return tr;
  const [change] = changes;
  const rename = syncEndName(tr.startState.doc, change.from, change.to, change.insert);
  if (!rename) return tr;
  // The end lies after the begin, so it moves by the size difference of the first change.
  const delta = change.insert.length - (change.to - change.from);
  return [tr, { changes: { from: rename.from + delta, to: rename.to + delta, insert: rename.insert }, sequential: true }];
});

export const latexEnvironments = [Prec.high(keymap.of([{ key: "Enter", run: enterCommand }])), keepPairs];
