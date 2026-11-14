/** Word count of readable text (spec 007 R6): commands, math, labels and comments don't count. */
import { readableRanges } from "./readable";

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

/** Words in plain text; `Intl.Segmenter` keeps Bangla and CJK words whole. */
export function countPlainWords(text: string): number {
  if (!segmenter) return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  let count = 0;
  for (const segment of segmenter.segment(text)) if (segment.isWordLike) count++;
  return count;
}

/** Words a reader sees in LaTeX source. */
export function countWords(latex: string): number {
  // Ranges are joined with a space, so `\textbf{a}b` does not merge into one word.
  return countPlainWords(readableRanges(latex).text.map((range) => latex.slice(range.from, range.to)).join(" "));
}

export type WordCountCache = Map<string, { text: string; count: number }>;

/** Sum over the document's files (main plus included, from the index); unchanged files come from `cache`. */
export function projectWordCount(files: string[], texts: Map<string, string>, cache: WordCountCache): number {
  let total = 0;
  for (const file of files) {
    const text = texts.get(file);
    if (text === undefined) continue;
    let hit = cache.get(file);
    if (!hit || hit.text !== text) {
      hit = { text, count: countWords(text) };
      cache.set(file, hit);
    }
    total += hit.count;
  }
  return total;
}
