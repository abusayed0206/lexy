import { DEFAULT_FONT, fontFromLines, fontLines, type FontChoice } from "./fonts";
import { readEngine } from "./engine";

export type Margins = { top: number; bottom: number; left: number; right: number };
export type FontSize = 10 | 11 | 12;
export type Paper = "a4" | "letter";
export type Orientation = "portrait" | "landscape";

export type DocumentSettings = {
  font: FontChoice;
  size: FontSize;
  paper: Paper;
  orientation: Orientation;
  margins: Margins;
};

export type MarginPreset = "normal" | "narrow" | "moderate" | "wide";

/** Word's presets, in cm. */
export const MARGIN_PRESETS: Record<MarginPreset, Margins> = {
  normal: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 },
  narrow: { top: 1.27, bottom: 1.27, left: 1.27, right: 1.27 },
  moderate: { top: 2.54, bottom: 2.54, left: 1.91, right: 1.91 },
  wide: { top: 2.54, bottom: 2.54, left: 5.08, right: 5.08 },
};

export const MIN_MARGIN = 0.5;
export const MAX_MARGIN = 6;

export const DEFAULT_SETTINGS: DocumentSettings = {
  font: DEFAULT_FONT,
  size: 10,
  paper: "a4",
  orientation: "portrait",
  margins: MARGIN_PRESETS.normal,
};

export const BLOCK_START = "% --- Lexy settings (edited by Lexy's Home and Layout tabs) ---";
export const BLOCK_END = "% --- end Lexy settings ---";
export const XELATEX_MARKER = "% !TEX program = xelatex";

const CLASS = /^(\s*\\documentclass\s*)(?:\[([^\]]*)\])?(\s*\{[^}]*\}.*)$/;
const GEOMETRY = /^\\usepackage\[([^\]]*)\]\{geometry\}$/;
const SIZE_OPTION = /^\s*(\d+)pt\s*$/;

function splitLines(source: string): { lines: string[]; eol: string } {
  return { lines: source.split(/\r?\n/), eol: source.includes("\r\n") ? "\r\n" : "\n" };
}

function classLineIndex(lines: string[]): number {
  return lines.findIndex((line) => !line.trimStart().startsWith("%") && CLASS.test(line));
}

function findBlock(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => line.trim().startsWith("% --- Lexy settings"));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line.trim().startsWith("% --- end Lexy settings"));
  return end < 0 ? null : { start, end };
}

export function hasSettingsBlock(source: string): boolean {
  return findBlock(splitLines(source).lines) !== null;
}

export function isValidMargin(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_MARGIN && value <= MAX_MARGIN;
}

export function marginPresetOf(margins: Margins): MarginPreset | null {
  const entry = Object.entries(MARGIN_PRESETS).find(([, preset]) =>
    (["top", "bottom", "left", "right"] as const).every((side) => Math.abs(preset[side] - margins[side]) < 0.005),
  );
  return entry ? (entry[0] as MarginPreset) : null;
}

/** Settings as written in the document; defaults for anything Lexy didn't write. Never throws. */
export function parseSettings(source: string): DocumentSettings {
  const { lines } = splitLines(source);
  const settings: DocumentSettings = { ...DEFAULT_SETTINGS, margins: { ...DEFAULT_SETTINGS.margins } };

  const classIndex = classLineIndex(lines);
  if (classIndex >= 0) {
    const options = CLASS.exec(lines[classIndex])?.[2] ?? "";
    for (const option of options.split(",")) {
      const size = SIZE_OPTION.exec(option);
      if (size && ["10", "11", "12"].includes(size[1])) settings.size = Number(size[1]) as FontSize;
    }
  }

  const block = findBlock(lines);
  if (!block) return settings;
  const inner = lines.slice(block.start + 1, block.end);
  for (const line of inner) {
    const geometry = GEOMETRY.exec(line.trim());
    if (!geometry) continue;
    for (const raw of geometry[1].split(",")) {
      const option = raw.trim();
      if (option === "a4paper") settings.paper = "a4";
      else if (option === "letterpaper") settings.paper = "letter";
      else if (option === "portrait" || option === "landscape") settings.orientation = option;
      else {
        const margin = /^(top|bottom|left|right)=([\d.]+)cm$/.exec(option);
        if (margin && isValidMargin(Number(margin[2]))) {
          settings.margins[margin[1] as keyof Margins] = Number(margin[2]);
        }
      }
    }
  }
  settings.font = fontFromLines(inner) ?? DEFAULT_FONT;
  return settings;
}

function cm(value: number): string {
  return `${Math.round(value * 100) / 100}cm`;
}

export function geometryLine(settings: DocumentSettings): string {
  const { top, bottom, left, right } = settings.margins;
  return `\\usepackage[${settings.paper}paper,${settings.orientation},top=${cm(top)},bottom=${cm(bottom)},left=${cm(left)},right=${cm(right)}]{geometry}`;
}

function withSizeOption(options: string | undefined, size: FontSize): string {
  const kept = (options ?? "")
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option && !SIZE_OPTION.test(option));
  return [...kept, `${size}pt`].join(",");
}

/**
 * Rewrite Lexy's block (creating it after \documentclass), the class size option and
 * the XeLaTeX marker. Touches no other line. Returns null when there is no \documentclass.
 * Throws on invalid margins or font names so they are never written.
 */
export function applySettings(source: string, settings: DocumentSettings): string | null {
  for (const side of ["top", "bottom", "left", "right"] as const) {
    if (!isValidMargin(settings.margins[side])) {
      throw new Error(`The ${side} margin must be between ${MIN_MARGIN} and ${MAX_MARGIN} cm`);
    }
  }
  const block = [BLOCK_START, geometryLine(settings), ...fontLines(settings.font), BLOCK_END];

  const { lines, eol } = splitLines(source);
  const classIndex = classLineIndex(lines);
  if (classIndex < 0) return null;

  const match = CLASS.exec(lines[classIndex])!;
  lines[classIndex] = `${match[1]}[${withSizeOption(match[2], settings.size)}]${match[3]}`;

  const existing = findBlock(lines);
  if (existing) lines.splice(existing.start, existing.end - existing.start + 1, ...block);
  else lines.splice(classIndex + 1, 0, ...block);

  // Lexy owns only its exact marker line; engine lines chosen in the Engine menu stay (spec 008 R5).
  const marker = lines.slice(0, 5).findIndex((line) => line.trim() === XELATEX_MARKER);
  const wantsMarker = settings.font.kind !== "builtin";
  if (marker >= 0 && !wantsMarker) lines.splice(marker, 1);
  if (marker < 0 && wantsMarker) {
    const engine = readEngine(lines.join("\n"));
    if (engine.choice === "pdflatex" && engine.line !== null) lines[engine.line] = XELATEX_MARKER;
    else if (engine.choice === "auto") lines.unshift(XELATEX_MARKER);
  }

  return lines.join(eol);
}

/** True when applying `settings` turns an explicit pdfLaTeX engine line into Lexy's XeLaTeX one. */
export function replacesPdflatexLine(source: string, settings: DocumentSettings): boolean {
  return settings.font.kind !== "builtin" && readEngine(source).choice === "pdflatex";
}

const CONFLICTING =
  /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\b(geometry|lmodern|newtxtext|newpxtext|helvet|XCharter|libertine|fontspec|mathpazo|mathptmx|times|palatino|charter)\b[^}]*\}|\\setmainfont/;

/** User preamble lines (outside Lexy's block) that also set margins or fonts. */
export function conflicts(source: string): string[] {
  const { lines } = splitLines(source);
  const block = findBlock(lines);
  const beginDocument = lines.findIndex((line) => line.includes("\\begin{document}"));
  const preambleEnd = beginDocument < 0 ? lines.length : beginDocument;
  return lines
    .slice(0, preambleEnd)
    .filter((_, index) => !(block && index >= block.start && index <= block.end))
    .filter((line) => !line.trimStart().startsWith("%") && CONFLICTING.test(line))
    .map((line) => line.trim());
}
