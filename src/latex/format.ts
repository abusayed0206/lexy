/** A single text change plus where the selection goes afterwards. Offsets are in the old text. */
export type TextEdit = { from: number; to: number; insert: string; selectFrom: number; selectTo: number };
export type Selection = { from: number; to: number };

function lineStart(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

function lineEnd(text: string, pos: number): number {
  const end = text.indexOf("\n", pos);
  return end < 0 ? text.length : end;
}

/** `\cmd{selection}`; toggles off when the selection is already exactly wrapped. */
export function wrap(text: string, { from, to }: Selection, command: string): TextEdit {
  const open = `\\${command}{`;
  if (text.slice(from - open.length, from) === open && text[to] === "}") {
    const inner = text.slice(from, to);
    const start = from - open.length;
    return { from: start, to: to + 1, insert: inner, selectFrom: start, selectTo: start + inner.length };
  }
  const inner = text.slice(from, to);
  const start = from + open.length;
  return { from, to, insert: `${open}${inner}}`, selectFrom: start, selectTo: start + inner.length };
}

const HEADING = /^(\s*)\\(sub)?(sub)?section\*?\{(.*)\}\s*$/;

/** Level 0 = Normal, 1–3 = \section, \subsection, \subsubsection, for the line at the cursor. */
export function setHeading(text: string, { from }: Selection, level: 0 | 1 | 2 | 3): TextEdit {
  const start = lineStart(text, from);
  const end = lineEnd(text, from);
  const line = text.slice(start, end);
  const existing = HEADING.exec(line);
  const indent = existing ? existing[1] : (/^\s*/.exec(line)?.[0] ?? "");
  const content = existing ? existing[4] : line.trim();
  const prefix = level === 0 ? "" : `\\${"sub".repeat(level - 1)}section{`;
  const insert = level === 0 ? `${indent}${content}` : `${indent}${prefix}${content}}`;
  const contentStart = start + indent.length + prefix.length;
  return { from: start, to: end, insert, selectFrom: contentStart, selectTo: contentStart + content.length };
}

export function headingLevelAt(text: string, pos: number): 0 | 1 | 2 | 3 {
  const match = HEADING.exec(text.slice(lineStart(text, pos), lineEnd(text, pos)));
  if (!match) return 0;
  return (1 + (match[2] ? 1 : 0) + (match[3] ? 1 : 0)) as 1 | 2 | 3;
}

/** Selected lines (or the current one) → itemize/enumerate with one \item per non-blank line. */
export function toList(text: string, { from, to }: Selection, kind: "itemize" | "enumerate"): TextEdit {
  const start = lineStart(text, from);
  const end = lineEnd(text, Math.max(from, to - (to > from && text[to - 1] === "\n" ? 1 : 0)));
  const items = text
    .slice(start, end)
    .split("\n")
    .map((line) => line.trim().replace(/^\\item\s*/, ""))
    .filter((line) => line.length > 0);
  const head = `\\begin{${kind}}\n`;
  const body = (items.length ? items : [""]).map((item) => `  \\item ${item}`).join("\n");
  const insert = `${head}${body}\n\\end{${kind}}`;
  // Cursor at the end of the last item.
  const cursor = start + head.length + body.length;
  return { from: start, to: end, insert, selectFrom: cursor, selectTo: cursor };
}

/** Insert `snippet` on its own line at the cursor. */
function ownLine(text: string, { from, to }: Selection, snippet: string): TextEdit {
  const before = from > 0 && text[from - 1] !== "\n" ? "\n" : "";
  const after = to < text.length && text[to] !== "\n" ? "\n" : "";
  const insert = `${before}${snippet}${after}`;
  const cursor = from + before.length + snippet.length;
  return { from, to, insert, selectFrom: cursor, selectTo: cursor };
}

export function pageBreak(text: string, selection: Selection): TextEdit {
  return ownLine(text, selection, "\\newpage");
}

export function footnote(text: string, selection: Selection): TextEdit {
  return wrap(text, selection, "footnote");
}

/** Insert a block (table, display equation) on its own lines; cursor at `cursorOffset` inside it. */
export function insertBlock(text: string, selection: Selection, block: string, cursorOffset = block.length): TextEdit {
  const edit = ownLine(text, selection, block);
  const blockStart = edit.selectFrom - block.length;
  return { ...edit, selectFrom: blockStart + cursorOffset, selectTo: blockStart + cursorOffset };
}

/** Plain text replacement with the cursor after it (inline equations, edited equations). */
export function replaceWith(selection: Selection, insert: string): TextEdit {
  const cursor = selection.from + insert.length;
  return { from: selection.from, to: selection.to, insert, selectFrom: cursor, selectTo: cursor };
}
