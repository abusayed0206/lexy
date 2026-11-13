import { invoke } from "@tauri-apps/api/core";

export type BuiltinFontId = "latin-modern" | "times" | "palatino" | "helvetica" | "charter" | "libertine";

export type FontChoice = { kind: "builtin"; id: BuiltinFontId } | { kind: "system"; family: string };

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

export function fontLines(font: FontChoice): string[] {
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
    const match = /^\\setmainfont\{([^}]*)\}$/.exec(line);
    if (match && isValidFamily(match[1])) return { kind: "system", family: match[1] };
  }
  const builtin = BUILTIN_FONTS.find((entry) => entry.lines.every((line) => trimmed.includes(line)));
  return builtin ? { kind: "builtin", id: builtin.id } : null;
}

export function fontLabel(font: FontChoice): string {
  if (font.kind === "system") return font.family;
  return BUILTIN_FONTS.find((entry) => entry.id === font.id)?.label ?? font.id;
}

export function sameFont(a: FontChoice, b: FontChoice): boolean {
  return a.kind === "builtin" && b.kind === "builtin" ? a.id === b.id : a.kind === "system" && b.kind === "system" && a.family === b.family;
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
