/** Word-level comparison for Review → Compare (spec 007 US4): Myers' O(ND) diff over words and spaces. */

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

/** Words, runs of whitespace and single punctuation marks, so a changed word doesn't swallow its neighbours. */
export function tokens(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_\\]+|[^\s\p{L}\p{N}_\\]/gu) ?? [];
}

/** Above this many differing tokens the diff falls back to whole-text replace (keeps the view responsive). */
const MAX_EDITS = 4000;

/** Myers diff of `a` → `b`, as runs of same / removed / added text. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  // Trim the common start and end first: usually most of a document.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = myers(a.slice(start, endA), b.slice(start, endB));
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  push("same", a.slice(0, start).join(""));
  for (const part of middle) push(part.kind, part.text);
  push("same", a.slice(endA).join(""));
  return parts;
}

function myers(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  if (!n) return m ? [{ kind: "added", text: b.join("") }] : [];
  if (!m) return [{ kind: "removed", text: a.join("") }];
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return [{ kind: "removed", text: a.join("") }, { kind: "added", text: b.join("") }];

  // Walk back through the trace to recover the edit script.
  const parts: DiffPart[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && prev[offset + k - 1] < prev[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = prev[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      parts.push({ kind: "same", text: a[x] });
    }
    if (x === prevX) {
      y--;
      parts.push({ kind: "added", text: b[y] });
    } else {
      x--;
      parts.push({ kind: "removed", text: a[x] });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    parts.push({ kind: "same", text: a[x] });
  }
  return parts.reverse();
}
