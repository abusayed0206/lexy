import { XELATEX_MARKER } from "./settings";

export const BANGLA_BLOCK_START = "% --- Lexy Bangla font (BCC Purno in fonts/) ---";
export const BANGLA_BLOCK_END = "% --- end Lexy Bangla font ---";
/**
 * Must match the font files `install_bangla_font` copies (src-tauri/src/bangla.rs).
 * Script=Bengali turns on the font's Bengali shaping; without it conjuncts fall apart.
 */
export const PURNO_SETUP = [
  "\\usepackage{fontspec}",
  "\\setmainfont{BCCPurno}[Path=fonts/, Extension=.ttf, Script=Bengali, UprightFont=*-Regular, BoldFont=*-Bold, ItalicFont=*-Italic, BoldItalicFont=*-BoldItalic]",
];

/**
 * The document with BCC Purno set up: the XeLaTeX marker on line 1 (for other editors) and a
 * marked block right after `\documentclass`. An older version of the block is replaced.
 * Null when there is no class line or the block is already current. Lexy edits nothing else.
 */
export function addPurnoSetup(source: string): string | null {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === BANGLA_BLOCK_START);
  if (start >= 0) {
    const end = lines.findIndex((line, index) => index > start && line.trim() === BANGLA_BLOCK_END);
    if (end < 0) return null;
    const current = lines.slice(start + 1, end).map((line) => line.trim());
    if (current.length === PURNO_SETUP.length && current.every((line, index) => line === PURNO_SETUP[index])) return null;
    lines.splice(start + 1, end - start - 1, ...PURNO_SETUP);
    return lines.join(eol);
  }
  const classLine = lines.findIndex((line) => line.trimStart().startsWith("\\documentclass"));
  if (classLine < 0) return null;
  lines.splice(classLine + 1, 0, BANGLA_BLOCK_START, ...PURNO_SETUP, BANGLA_BLOCK_END);
  if (!lines.slice(0, 5).some((line) => /^%\s*!TEX\s+(TS-)?program\s*=/i.test(line.trim()))) lines.unshift(XELATEX_MARKER);
  return lines.join(eol);
}

/** True when the document has Lexy's Bangla block in an older form (needs `addPurnoSetup`). */
export function hasOutdatedPurnoSetup(source: string): boolean {
  return source.includes(BANGLA_BLOCK_START) && addPurnoSetup(source) !== null;
}
