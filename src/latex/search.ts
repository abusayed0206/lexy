/** Find and replace across the project (spec 007 R13), over disk text with unsaved buffers applied. */

export type SearchOptions = { matchCase: boolean; wholeWord: boolean; regex: boolean };
export type SearchHit = { line: number; from: number; to: number; preview: string; previewFrom: number; previewTo: number };
export type FileHits = { file: string; hits: SearchHit[] };

export const MAX_HITS = 5000;

export class InvalidPattern extends Error {}

/** The RegExp for `query` (global), or an `InvalidPattern` with the browser's message. */
export function searchPattern(query: string, options: SearchOptions): RegExp {
  let source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${options.matchCase ? "" : "i"}`);
  } catch (error) {
    throw new InvalidPattern(error instanceof Error ? error.message.replace(/^Invalid regular expression: /, "") : String(error));
  }
}

const PREVIEW = 120;

/** Matches per file (files in the given order, only files with hits), at most `MAX_HITS` in total. */
export function searchProject(texts: Map<string, string>, query: string, options: SearchOptions): { results: FileHits[]; truncated: boolean } {
  const results: FileHits[] = [];
  if (!query) return { results, truncated: false };
  const pattern = searchPattern(query, options);
  let total = 0;
  for (const [file, text] of texts) {
    const hits: SearchHit[] = [];
    let line = 1;
    let lineStart = 0;
    let scanned = 0;
    pattern.lastIndex = 0;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (m[0] === "") {
        pattern.lastIndex++; // empty matches (e.g. `^`) would loop forever
        continue;
      }
      for (; scanned < m.index; scanned++) {
        if (text[scanned] === "\n") {
          line++;
          lineStart = scanned + 1;
        }
      }
      const lineEndAt = text.indexOf("\n", m.index);
      const lineEnd = lineEndAt < 0 ? text.length : lineEndAt;
      const start = Math.max(lineStart, m.index - 40);
      const preview = text.slice(start, Math.min(lineEnd, start + PREVIEW));
      hits.push({
        line,
        from: m.index,
        to: m.index + m[0].length,
        preview: preview.replace(/\t/g, " "),
        previewFrom: m.index - start,
        previewTo: Math.min(preview.length, m.index - start + m[0].length),
      });
      if (++total >= MAX_HITS) {
        results.push({ file, hits });
        return { results, truncated: true };
      }
    }
    if (hits.length) results.push({ file, hits });
  }
  return { results, truncated: false };
}

/** `text` with every match replaced (`$1`… groups work in regex mode), and how many there were. */
export function replaceIn(text: string, query: string, options: SearchOptions, replacement: string): { text: string; count: number } {
  const pattern = searchPattern(query, options);
  const count = [...text.matchAll(pattern)].filter((m) => m[0] !== "").length;
  if (!count) return { text, count };
  // A string replacement expands `$1`; a function keeps plain text literal (a `$` in it stays a `$`).
  return { text: options.regex ? text.replace(pattern, replacement) : text.replace(pattern, () => replacement), count };
}
