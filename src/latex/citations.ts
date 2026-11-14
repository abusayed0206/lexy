/** Citations (spec 007 US3): keys for new entries, `\cite`, and the bibliography commands. */
import type { TextEdit } from "./format";
import { parseBibEntries } from "./index";

/** ASCII letters of a name, lower-cased ("Gödel" → "godel"). */
function asciiWord(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const STOP_WORDS = new Set(["a", "an", "the", "on", "of", "in", "for", "and", "to", "with", "at", "by"]);

/** The first author's family name: "Knuth, Donald" or "Donald E. Knuth" → "knuth". */
function familyName(authors: string): string {
  const first = authors.split(/\s+and\s+/i)[0]?.trim() ?? "";
  const family = first.includes(",") ? first.split(",")[0] : (first.split(/\s+/).pop() ?? "");
  return asciiWord(family);
}

/** `knuth1984literate`, made unique against `existing` with a, b, c… */
export function uniqueKey(entry: { author: string; year: string; title: string }, existing: Iterable<string>): string {
  const word = entry.title
    .split(/\s+/)
    .map(asciiWord)
    .find((w) => w && !STOP_WORDS.has(w));
  const base = `${familyName(entry.author) || "ref"}${entry.year.replace(/\D/g, "").slice(0, 4)}${word ?? ""}` || "ref";
  const taken = new Set([...existing].map((key) => key.toLowerCase()));
  if (!taken.has(base)) return base;
  for (const letter of "abcdefghijklmnopqrstuvwxyz") if (!taken.has(base + letter)) return base + letter;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** The first entry of fetched BibTeX, with its key replaced by `key`; null if it isn't BibTeX. */
export function rekey(bibtex: string, key: string): string | null {
  const head = /(@[A-Za-z]+\s*\{\s*)[^,\s{}]*(\s*,)/;
  const start = bibtex.search(head);
  if (start < 0) return null;
  // A function replacement keeps `$` in the key literal.
  return bibtex.slice(start).replace(head, (_all, open: string, comma: string) => `${open}${key}${comma}`).trim();
}

/** Parsed fields of the first entry in `bibtex`, for the review step. */
export function firstEntry(bibtex: string) {
  return parseBibEntries(bibtex)[0] ?? null;
}

/** `\cite{a,b}` at the cursor, or into an existing `\cite{…}` the cursor is in. */
export function insertCitation(text: string, at: number, keys: string[]): TextEdit {
  const before = text.slice(0, at);
  const open = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\[[^\]]*\])*\{([^}]*)$/.exec(before);
  if (open && text.indexOf("}", at) >= 0 && !text.slice(at, text.indexOf("}", at)).includes("{")) {
    const existing = open[1].trim();
    const insert = (existing && !existing.endsWith(",") ? "," : "") + keys.join(",");
    return { from: at, to: at, insert, selectFrom: at + insert.length, selectTo: at + insert.length };
  }
  const insert = `\\cite{${keys.join(",")}}`;
  return { from: at, to: at, insert, selectFrom: at + insert.length, selectTo: at + insert.length };
}

/** Adds `\bibliographystyle{plain}` + `\bibliography{name}` before `\end{document}` when no bibliography command exists. */
export function bibliographySetup(mainText: string, bibName = "references"): TextEdit | null {
  if (/\\(bibliography|addbibresource|printbibliography)\s*[{[]/.test(mainText) || /\\printbibliography\b/.test(mainText)) return null;
  const end = mainText.search(/\\end\s*\{document\}/);
  if (end < 0) return null;
  const insert = `\\bibliographystyle{plain}\n\\bibliography{${bibName}}\n\n`;
  return { from: end, to: end, insert, selectFrom: end + insert.length, selectTo: end + insert.length };
}

/** `existing` with `entry` appended after one blank line. */
export function appendEntry(existing: string, entry: string): string {
  const trimmed = existing.replace(/\s+$/, "");
  return `${trimmed}${trimmed ? "\n\n" : ""}${entry.trim()}\n`;
}
