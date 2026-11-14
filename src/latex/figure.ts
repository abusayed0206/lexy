/** Images (spec 007 US3): a figure block and the one `graphicx` line it needs. */
import type { TextEdit } from "./format";
import { BLOCK_END } from "./settings";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "pdf", "eps"];

export function isImage(path: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");
}

/** A figure for `relPath` (project-relative); `\includegraphics` paths use `/`. */
export function figureBlock(relPath: string): { text: string; captionOffset: number } {
  const path = relPath.replace(/\\/g, "/");
  const stem = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const label = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "figure";
  const head = `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{${path}}\n  \\caption{`;
  const text = `${head}Caption}\n  \\label{fig:${label}}\n\\end{figure}\n`;
  return { text, captionOffset: head.length };
}

/** The figure at `at` on a line of its own; the caption placeholder is selected. */
export function insertFigure(text: string, at: number, relPath: string): TextEdit {
  const { text: block, captionOffset } = figureBlock(relPath);
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const onEmptyLine = text.slice(lineStart, at).trim() === "" && (text.indexOf("\n", at) < 0 ? text.slice(at) : text.slice(at, text.indexOf("\n", at))).trim() === "";
  const insert = onEmptyLine ? block : `\n${block}`;
  const start = at + insert.length - block.length + captionOffset;
  return { from: at, to: at, insert, selectFrom: start, selectTo: start + "Caption".length };
}

/**
 * Adds one `\usepackage{graphicx}` line after the Lexy settings block, else after the
 * `\documentclass` line; null when graphicx is already loaded. No other preamble line changes.
 */
export function ensureGraphicx(mainText: string): TextEdit | null {
  return ensurePackage(mainText, "graphicx");
}

/** One `\usepackage{name}` line, placed like `ensureGraphicx`; null when the package is already loaded. */
export function ensurePackage(mainText: string, name: string): TextEdit | null {
  if (new RegExp(`\\\\usepackage\\s*(\\[[^\\]]*\\])?\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(mainText)) return null;
  const blockEnd = mainText.indexOf(BLOCK_END);
  let at: number;
  if (blockEnd >= 0) {
    at = mainText.indexOf("\n", blockEnd);
  } else {
    const cls = /\\documentclass\s*(\[[^\]]*\])?\s*\{[^}]*\}/.exec(mainText);
    if (!cls) return null;
    at = mainText.indexOf("\n", cls.index + cls[0].length);
  }
  if (at < 0) at = mainText.length;
  const insert = `\n\\usepackage{${name}}`;
  return { from: at, to: at, insert, selectFrom: at + insert.length, selectTo: at + insert.length };
}
