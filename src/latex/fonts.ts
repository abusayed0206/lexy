import { invoke } from "@tauri-apps/api/core";

export type BuiltinFontId = "latin-modern" | "times" | "palatino" | "helvetica" | "charter" | "libertine";

/** Font files saved in the project's `fonts` folder (from the kriti.app catalog). Mirrors `kriti::ProjectFont`. */
export type ProjectFont = { family: string; regular: string; bold?: string | null; italic?: string | null; boldItalic?: string | null };

export type FontChoice =
  | { kind: "builtin"; id: BuiltinFontId }
  | { kind: "system"; family: string }
  | ({ kind: "project" } & ProjectFont)
  /** A kriti.app family picked in the menu; the Writer installs it, which turns it into "project". */
  | { kind: "kriti"; family: string };

/** Fonts that work with pdfLaTeX (research R3). */
export const BUILTIN_FONTS: { id: BuiltinFontId; label: string; lines: string[] }[] = [
  { id: "latin-modern", label: "Latin Modern", lines: ["\\usepackage{lmodern}", "\\usepackage[T1]{fontenc}"] },
  { id: "times", label: "Times", lines: ["\\usepackage{newtxtext,newtxmath}"] },
  { id: "palatino", label: "Palatino", lines: ["\\usepackage{newpxtext,newpxmath}"] },
  {
    id: "helvetica",
    label: "Helvetica",
    lines: ["\\usepackage[scaled]{helvet}", "\\renewcommand{\\familydefault}{\\sfdefault}", "\\usepackage[T1]{fontenc}"],
  },
  { id: "charter", label: "Charter", lines: ["\\usepackage{XCharter}"] },
  { id: "libertine", label: "Linux Libertine", lines: ["\\usepackage{libertine}", "\\usepackage[libertine]{newtxmath}"] },
];

export const DEFAULT_FONT: FontChoice = { kind: "builtin", id: "latin-modern" };

// Same rule as is_valid_family in src-tauri/src/lib.rs: nothing that can break out of \setmainfont{…}.
const FAMILY = /^[A-Za-z0-9 _.'&+-]{1,64}$/;

export function isValidFamily(name: string): boolean {
  return FAMILY.test(name);
}

const FONT_FILE = /^[A-Za-z0-9._-]{1,120}\.(ttf|otf)$/i;
const PROJECT_LINE = /^\\setmainfont\{([^}]+)\}\[Path=fonts\/, Script=Bengali((?:, (?:BoldFont|ItalicFont|BoldItalicFont)=[^,\]]+)*)\]$/;
const PROJECT_FAMILY = /^% kriti\.app font: (.+)$/;

export function fontLines(font: FontChoice): string[] {
  if (font.kind === "kriti") throw new Error(`${font.family} must be added to the project first`);
  if (font.kind === "project") {
    const files = [font.regular, font.bold, font.italic, font.boldItalic].filter((file): file is string => !!file);
    if (!files.every((file) => FONT_FILE.test(file))) throw new Error(`"${font.family}" has unusable font file names`);
    // Script=Bengali turns on Bengali shaping (conjuncts, vowel signs); these are Bangla fonts.
    const extra = [
      font.bold ? `, BoldFont=${font.bold}` : "",
      font.italic ? `, ItalicFont=${font.italic}` : "",
      font.boldItalic ? `, BoldItalicFont=${font.boldItalic}` : "",
    ].join("");
    const family = isValidFamily(font.family) ? font.family : font.regular;
    return [`% kriti.app font: ${family}`, "\\usepackage{fontspec}", `\\setmainfont{${font.regular}}[Path=fonts/, Script=Bengali${extra}]`];
  }
  if (font.kind === "system") {
    if (!isValidFamily(font.family)) throw new Error(`"${font.family}" is not a usable font name`);
    return ["\\usepackage{fontspec}", `\\setmainfont{${font.family}}`];
  }
  const builtin = BUILTIN_FONTS.find((entry) => entry.id === font.id);
  if (!builtin) throw new Error(`Unknown font "${font.id}"`);
  return builtin.lines;
}

/** Reverse of fontLines for the lines inside Lexy's settings block. */
export function fontFromLines(lines: string[]): FontChoice | null {
  const trimmed = lines.map((line) => line.trim());
  for (const line of trimmed) {
    const project = PROJECT_LINE.exec(line);
    if (project && FONT_FILE.test(project[1])) {
      const option = (name: string) => new RegExp(`, ${name}=([^,\\]]+)`).exec(project[2])?.[1] ?? null;
      const family = trimmed.map((other) => PROJECT_FAMILY.exec(other)?.[1]).find(Boolean) ?? project[1].replace(/\.(ttf|otf)$/i, "");
      return { kind: "project", family, regular: project[1], bold: option("BoldFont"), italic: option("ItalicFont"), boldItalic: option("BoldItalicFont") };
    }
    const match = /^\\setmainfont\{([^}]*)\}$/.exec(line);
    if (match && isValidFamily(match[1])) return { kind: "system", family: match[1] };
  }
  const builtin = BUILTIN_FONTS.find((entry) => entry.lines.every((line) => trimmed.includes(line)));
  return builtin ? { kind: "builtin", id: builtin.id } : null;
}

export function fontLabel(font: FontChoice): string {
  if (font.kind !== "builtin") return font.family;
  return BUILTIN_FONTS.find((entry) => entry.id === font.id)?.label ?? font.id;
}

export function sameFont(a: FontChoice, b: FontChoice): boolean {
  if (a.kind === "builtin" || b.kind === "builtin") return a.kind === "builtin" && b.kind === "builtin" && a.id === b.id;
  if (a.kind === "project" && b.kind === "project") return a.regular === b.regular;
  return a.kind === b.kind && a.family === b.family;
}

let systemFonts: Promise<string[]> | null = null;

/** Installed font families (fetched once; a failure is retried on the next call). */
export function listSystemFonts(): Promise<string[]> {
  systemFonts ??= invoke<string[]>("list_system_fonts").catch((error) => {
    systemFonts = null;
    throw error;
  });
  return systemFonts;
}

export type KritiFamily = { family: string; designer: string; license: string; styles: string[] };

let kritiFonts: Promise<KritiFamily[]> | null = null;

/** Distributable Unicode Bangla families from kriti.app (fetched once; retried after a failure). */
export function listKritiFonts(): Promise<KritiFamily[]> {
  kritiFonts ??= invoke<KritiFamily[]>("kriti_fonts").catch((error) => {
    kritiFonts = null;
    throw error;
  });
  return kritiFonts;
}

/** Copy a kriti.app family into the `fonts` folder next to the main document. */
export const installKritiFont = (main: string, family: string) => invoke<ProjectFont>("install_kriti_font", { main, family });
