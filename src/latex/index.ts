/**
 * Project index (spec 007 R1, data-model.md "ProjectIndex"): macros, labels, bibliography entries and
 * the outline, parsed from the text of every project file plus unsaved buffers.
 */

export type Macro = { name: string; args: number; file: string; line: number };
export type Label = { key: string; file: string; line: number; context: string; duplicate: boolean };
export type BibEntry = { key: string; type: string; title: string; author: string; year: string; file: string; line: number };
export type OutlineKind = "part" | "chapter" | "section" | "subsection" | "subsubsection" | "paragraph" | "subparagraph" | "figure" | "table";
export type OutlineEntry = { kind: OutlineKind; title: string; file: string; line: number; depth: number };
export type ProjectIndex = {
  macros: Macro[];
  labels: Label[];
  bibEntries: BibEntry[];
  outline: OutlineEntry[];
  /** The main document and every file it includes, in document order (for word count). */
  documentFiles: string[];
};

const LEVELS: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };

type Heading = { kind: OutlineKind; title: string; offset: number; line: number };
type Include = { target: string; offset: number };
/** One file's parse, cached by its text. */
type FileParse = {
  text: string;
  macros: Omit<Macro, "file">[];
  labels: Omit<Label, "file" | "duplicate">[];
  bibEntries: Omit<BibEntry, "file">[];
  headings: Heading[];
  includes: Include[];
};
export type IndexCache = Map<string, FileParse>;

/** Comments blanked to spaces, so offsets and lines stay the same. */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
    } else if (c === "%") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

/** 1-based line of `offset`. */
function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Contents of the `{…}` group starting at `open`, or null. */
function group(text: string, open: number): { inner: string; end: number } | null {
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

/** Readable title: commands and braces dropped, whitespace collapsed. */
export function plainTitle(source: string): string {
  return source
    .replace(/\\(label|index|footnote|cite\w*|ref)\s*\{[^}]*\}/g, "")
    .replace(/\\[A-Za-z@]+\*?/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/[{}~]/g, (c) => (c === "~" ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}

function parseTex(text: string): FileParse {
  const clean = stripComments(text);
  const starts = lineStarts(clean);
  const parse: FileParse = { text, macros: [], labels: [], bibEntries: [], headings: [], includes: [] };

  for (const m of clean.matchAll(/\\(?:re|provide)?newcommand\*?\s*\{?\s*\\([A-Za-z@]+)\s*\}?\s*(?:\[(\d)\])?/g)) {
    parse.macros.push({ name: m[1], args: m[2] ? Number(m[2]) : 0, line: lineOf(starts, m.index!) });
  }
  for (const m of clean.matchAll(/\\DeclareMathOperator\*?\s*\{\s*\\([A-Za-z@]+)\s*\}/g)) {
    parse.macros.push({ name: m[1], args: 0, line: lineOf(starts, m.index!) });
  }
  for (const m of clean.matchAll(/\\def\s*\\([A-Za-z@]+)((?:#\d)*)/g)) {
    parse.macros.push({ name: m[1], args: m[2].length / 2, line: lineOf(starts, m.index!) });
  }

  // Headings, floats and includes in one ordered pass, so labels can take the nearest title as context.
  const events: { offset: number; run: () => void }[] = [];
  let context = "";
  for (const m of clean.matchAll(/\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(\[[^\]]*\])?\s*(?=\{)/g)) {
    const g = group(clean, m.index! + m[0].length);
    if (!g) continue;
    const title = plainTitle(g.inner) || "(untitled)";
    events.push({ offset: m.index!, run: () => {
      parse.headings.push({ kind: m[1] as OutlineKind, title, offset: m.index!, line: lineOf(starts, m.index!) });
      context = title;
    } });
  }
  for (const m of clean.matchAll(/\\begin\s*\{(figure|table)\*?\}/g)) {
    const endAt = clean.indexOf(`\\end{${m[1]}`, m.index!);
    const body = clean.slice(m.index!, endAt < 0 ? clean.length : endAt);
    const caption = /\\caption\s*(\[[^\]]*\])?\s*(?=\{)/.exec(body);
    const g = caption ? group(body, caption.index + caption[0].length) : null;
    const title = (g && plainTitle(g.inner)) || "(no caption)";
    events.push({ offset: m.index!, run: () => {
      parse.headings.push({ kind: m[1] as OutlineKind, title, offset: m.index!, line: lineOf(starts, m.index!) });
    } });
  }
  for (const m of clean.matchAll(/\\(input|include|subfile)\s*\{([^}]+)\}/g)) {
    events.push({ offset: m.index!, run: () => parse.includes.push({ target: m[2].trim(), offset: m.index! }) });
  }
  for (const m of clean.matchAll(/\\label\s*\{([^}]+)\}/g)) {
    events.push({ offset: m.index!, run: () => {
      const line = lineOf(starts, m.index!);
      const lineText = plainTitle(clean.slice(starts[line - 1], starts[line] ?? clean.length));
      parse.labels.push({ key: m[1].trim(), line, context: context || lineText });
    } });
  }
  // Captions give context to the labels that follow them inside floats.
  for (const m of clean.matchAll(/\\caption\s*(\[[^\]]*\])?\s*(?=\{)/g)) {
    const g = group(clean, m.index! + m[0].length);
    if (g) events.push({ offset: m.index!, run: () => (context = plainTitle(g.inner) || context) });
  }
  events.sort((a, b) => a.offset - b.offset).forEach((event) => event.run());
  return parse;
}

/** `{…}` or `"…"` field value starting at `i` (after `=` and spaces). */
function bibValue(text: string, i: number): string {
  if (text[i] === "{") return group(text, i)?.inner ?? "";
  if (text[i] === '"') {
    const end = text.indexOf('"', i + 1);
    return end < 0 ? "" : text.slice(i + 1, end);
  }
  return /^[^,}\s]*/.exec(text.slice(i))?.[0] ?? "";
}

function parseBib(text: string): FileParse {
  const starts = lineStarts(text);
  const parse: FileParse = { text, macros: [], labels: [], bibEntries: [], headings: [], includes: [] };
  for (const m of text.matchAll(/@([A-Za-z]+)\s*\{\s*([^,\s{}]+)\s*,/g)) {
    const type = m[1].toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble") continue;
    const open = text.indexOf("{", m.index!);
    const body = group(text, open)?.inner ?? text.slice(open + 1);
    const field = (name: string) => {
      const f = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*`, "i").exec(body);
      return f ? plainTitle(bibValue(body, f.index + f[0].length)) : "";
    };
    parse.bibEntries.push({ key: m[2], type, title: field("title"), author: field("author"), year: field("year") || field("date").slice(0, 4), line: lineOf(starts, m.index!) });
  }
  return parse;
}

/** The entries in BibTeX text (key, type, title, author, year, 1-based line). */
export function parseBibEntries(text: string): Omit<BibEntry, "file">[] {
  return parseBib(text).bibEntries;
}

function parseFile(path: string, text: string): FileParse {
  return path.toLowerCase().endsWith(".bib") ? parseBib(text) : parseTex(text);
}

const norm = (path: string) => path.replace(/\//g, "\\").toLowerCase();

/** The project file an `\input{target}` refers to, tried next to the including file, then at the root. */
function resolveInclude(target: string, from: string, files: Map<string, string>): string | null {
  const rel = target.replace(/\//g, "\\").replace(/^\.\\/, "");
  const dir = from.includes("\\") ? from.slice(0, from.lastIndexOf("\\") + 1) : "";
  for (const base of dir ? [dir, ""] : [""]) {
    for (const name of [rel, `${rel}.tex`]) {
      const hit = files.get(norm(base + name));
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Build the index from every file's text (`texts`: path → text, unsaved buffers already applied).
 * Pass the same `cache` between calls: files whose text didn't change are not parsed again.
 */
export function buildIndex(texts: Map<string, string>, main: string | null, cache: IndexCache = new Map()): ProjectIndex {
  for (const path of [...cache.keys()]) if (!texts.has(path)) cache.delete(path);
  const parsed = new Map<string, FileParse>();
  for (const [path, text] of texts) {
    let entry = cache.get(path);
    if (!entry || entry.text !== text) {
      entry = parseFile(path, text);
      cache.set(path, entry);
    }
    parsed.set(path, entry);
  }

  const index: ProjectIndex = { macros: [], labels: [], bibEntries: [], outline: [], documentFiles: [] };
  const seen = new Map<string, number>();
  for (const [file, parse] of parsed) {
    index.macros.push(...parse.macros.map((macro) => ({ ...macro, file })));
    index.bibEntries.push(...parse.bibEntries.map((entry) => ({ ...entry, file })));
    for (const label of parse.labels) {
      seen.set(label.key, (seen.get(label.key) ?? 0) + 1);
      index.labels.push({ ...label, file, duplicate: false });
    }
  }
  for (const label of index.labels) label.duplicate = (seen.get(label.key) ?? 0) > 1;

  const byName = new Map<string, string>();
  for (const path of parsed.keys()) byName.set(norm(path), path);
  const mainPath = main ? byName.get(norm(main)) : undefined;
  const visiting = new Set<string>();
  let depth = 0;
  const walk = (file: string) => {
    if (visiting.has(file)) return;
    visiting.add(file);
    index.documentFiles.push(file);
    const parse = parsed.get(file)!;
    const items = [
      ...parse.headings.map((heading) => ({ offset: heading.offset, heading, include: null as Include | null })),
      ...parse.includes.map((include) => ({ offset: include.offset, heading: null as Heading | null, include })),
    ].sort((a, b) => a.offset - b.offset);
    for (const item of items) {
      if (item.heading) {
        const { kind, title, line } = item.heading;
        const level = LEVELS[kind];
        if (level !== undefined) depth = level;
        index.outline.push({ kind, title, file, line, depth: level ?? depth + 1 });
      } else if (item.include) {
        const target = resolveInclude(item.include.target, file, byName);
        if (target) walk(target);
      }
    }
  };
  if (mainPath) walk(mainPath);
  return index;
}
