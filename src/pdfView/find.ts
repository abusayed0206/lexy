/** The parts of a pdf.js `TextItem` that searching needs. */
export type TextItemLike = { str: string; width: number; height: number; transform: number[]; hasEOL?: boolean };

/** One page's text, normalised for searching, with each character's item and offset. */
export type PageText = { text: string; map: { item: number; offset: number }[] };

export type Match = { page: number; start: number; end: number };

/** A box in PDF user space: x, y of the bottom-left corner (y grows upwards). */
export type PdfRect = { x: number; y: number; width: number; height: number };

const SPACE = /\s/;

/** Lower-case one UTF-16 unit, keeping it when folding would change the length (offsets stay 1:1). */
function fold(ch: string): string {
  const lower = ch.toLocaleLowerCase();
  return lower.length === 1 ? lower : ch;
}

/**
 * Join a page's text items for searching (spec 008 research R6): line ends and runs of
 * whitespace become one space, letters are case-folded one unit at a time.
 */
export function pageText(items: readonly TextItemLike[]): PageText {
  let text = "";
  const map: PageText["map"] = [];
  let lastSpace = true;
  items.forEach((item, index) => {
    for (let offset = 0; offset < item.str.length; offset++) {
      const ch = item.str[offset];
      if (SPACE.test(ch)) {
        if (!lastSpace) {
          text += " ";
          map.push({ item: index, offset });
          lastSpace = true;
        }
        continue;
      }
      text += fold(ch);
      map.push({ item: index, offset });
      lastSpace = false;
    }
    if (item.hasEOL && !lastSpace) {
      text += " ";
      map.push({ item: index, offset: item.str.length });
      lastSpace = true;
    }
  });
  return { text, map };
}

/** The query in the same form as `pageText` (trimmed); empty when there is nothing to find. */
export function normalizeQuery(query: string): string {
  return pageText([{ str: query, width: 0, height: 0, transform: [1, 0, 0, 1, 0, 0] }]).text.trim();
}

/** Every non-overlapping match on every page, in reading order. */
export function findMatches(pages: readonly PageText[], query: string): Match[] {
  const needle = normalizeQuery(query);
  if (!needle) return [];
  const matches: Match[] = [];
  pages.forEach((page, index) => {
    for (let at = page.text.indexOf(needle); at >= 0; at = page.text.indexOf(needle, at + needle.length)) {
      matches.push({ page: index, start: at, end: at + needle.length });
    }
  });
  return matches;
}

/**
 * Boxes covering a match, one per text item it touches; the item's width is split in
 * proportion to its characters (approximate for proportional fonts, research R6).
 */
export function matchRects(match: Match, items: readonly TextItemLike[], page: PageText): PdfRect[] {
  const spans = new Map<number, { from: number; to: number }>();
  for (let index = match.start; index < match.end; index++) {
    const spot = page.map[index];
    const item = items[spot.item];
    if (!item || spot.offset >= item.str.length) continue; // the space added at a line end
    const span = spans.get(spot.item);
    if (span) span.to = spot.offset + 1;
    else spans.set(spot.item, { from: spot.offset, to: spot.offset + 1 });
  }
  return [...spans].map(([index, { from, to }]) => {
    const item = items[index];
    const [, , c, d, e, f] = item.transform;
    const length = item.str.length || 1;
    const height = item.height || Math.hypot(c, d);
    return { x: e + (item.width * from) / length, y: f, width: (item.width * (to - from)) / length, height };
  });
}

/** Index of the first hit at or after (`page`, `top`), wrapping to 0. */
export function nearestMatch(hits: readonly { page: number; top: number }[], page: number, top: number): number {
  const index = hits.findIndex((hit) => hit.page > page || (hit.page === page && hit.top >= top));
  return index < 0 ? 0 : index;
}
