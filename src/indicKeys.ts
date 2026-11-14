import { EditorSelection, Prec } from "@codemirror/state";
import { Direction, keymap, type Command } from "@codemirror/view";

/**
 * Bangla and other Indic scripts (spec 005, research R8). CodeMirror's cluster rules predate
 * Unicode 15.1, so it stops the cursor inside conjuncts like "ক্ষ". The browser's
 * Intl.Segmenter knows the conjunct rule. Windows text boxes move over a whole conjunct with
 * the arrow keys but delete one code point at a time with Backspace; this does the same.
 * Only text next to an Indic letter is handled; everything else keeps CodeMirror's behaviour.
 */

/** Devanagari through Sinhala (U+0900–U+0DFF). */
export function isIndic(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return code >= 0x0900 && code <= 0x0dff;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** Next (forward) or previous grapheme boundary in `text` from `offset`, or null at the edge. */
export function clusterBoundary(text: string, offset: number, forward: boolean): number | null {
  if (!segmenter) return null;
  let previous: number | null = null;
  for (const { index } of segmenter.segment(text)) {
    if (forward && index > offset) return index;
    if (!forward && index >= offset) return previous;
    previous = index;
  }
  if (forward) return offset < text.length ? text.length : null;
  return previous !== null && previous < offset ? previous : null;
}

function move(forward: boolean, extend: boolean): Command {
  return (view) => {
    const { main } = view.state.selection;
    if (view.state.selection.ranges.length > 1 || (!extend && !main.empty)) return false;
    const line = view.state.doc.lineAt(main.head);
    if (view.textDirectionAt(line.from) !== Direction.LTR) return false;
    const offset = main.head - line.from;
    if (!isIndic(forward ? line.text[offset] : line.text[offset - 1])) return false;
    const target = clusterBoundary(line.text, offset, forward);
    if (target === null) return false;
    const head = line.from + target;
    view.dispatch({
      selection: extend ? EditorSelection.range(main.anchor, head) : EditorSelection.cursor(head),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  };
}

/** Backspace after an Indic letter removes one code point (ক্ষ → ক্, আমি → আম). */
export const backspaceCodePoint: Command = (view) => {
  const { main } = view.state.selection;
  if (view.state.selection.ranges.length > 1 || !main.empty || main.head === 0) return false;
  const before = view.state.sliceDoc(main.head - 1, main.head);
  if (!isIndic(before)) return false;
  view.dispatch({ changes: { from: main.head - 1, to: main.head }, scrollIntoView: true, userEvent: "delete.backward" });
  return true;
};

export const indicKeys = Prec.high(
  keymap.of([
    { key: "ArrowLeft", run: move(false, false), shift: move(false, true) },
    { key: "ArrowRight", run: move(true, false), shift: move(true, true) },
    { key: "Backspace", run: backspaceCodePoint },
  ]),
);

