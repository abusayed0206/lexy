import type { TextEdit } from "./format";
import { XELATEX_MARKER } from "./settings";

/** Engine choice from the ribbon (spec 008 US3); `auto` means no engine line. */
export type EngineChoice = "auto" | "pdflatex" | "xelatex" | "lualatex";

/** The same rule as Rust `marker_engine`: a whole-line `% !TEX (TS-)program = <engine>` in the first 5 lines. */
const ENGINE_LINE = /^\s*%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)\s*$/i;
const MARKER_LINES = 5;

export type EngineLine = { choice: EngineChoice; line: number | null; setByFont: boolean };

/** The engine line the menu writes; the font settings own only the exact `XELATEX_MARKER` line. */
export const engineLine = (engine: Exclude<EngineChoice, "auto">) => `% !TEX TS-program = ${engine}`;

export function readEngine(text: string): EngineLine {
  const lines = text.split(/\r?\n/, MARKER_LINES);
  for (let index = 0; index < lines.length; index++) {
    const match = ENGINE_LINE.exec(lines[index]);
    if (match) return { choice: match[1].toLowerCase() as EngineChoice, line: index, setByFont: lines[index].trim() === XELATEX_MARKER };
  }
  return { choice: "auto", line: null, setByFont: false };
}

/** Offset of the start of `line` (0-based) in `text`. */
function lineOffset(text: string, line: number): number {
  let offset = 0;
  for (let index = 0; index < line; index++) offset = text.indexOf("\n", offset) + 1;
  return offset;
}

/**
 * The edit that makes `choice` the document's engine: replace the existing line in place,
 * insert one as line 1, or remove it for `auto`. Null when nothing changes.
 */
export function engineEdit(text: string, choice: EngineChoice): TextEdit | null {
  const current = readEngine(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (current.line === null) {
    if (choice === "auto") return null;
    const insert = engineLine(choice) + eol;
    return { from: 0, to: 0, insert, selectFrom: insert.length, selectTo: insert.length };
  }
  const from = lineOffset(text, current.line);
  const newline = text.indexOf("\n", from);
  const lineEnd = newline < 0 ? text.length : text[newline - 1] === "\r" ? newline - 1 : newline;
  if (choice === "auto") {
    const to = newline < 0 ? text.length : newline + 1;
    return { from, to, insert: "", selectFrom: from, selectTo: from };
  }
  const insert = engineLine(choice);
  if (current.choice === choice && text.slice(from, lineEnd) === insert) return null;
  return { from, to: lineEnd, insert, selectFrom: from + insert.length, selectTo: from + insert.length };
}
