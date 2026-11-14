/**
 * Which parts of LaTeX source a reader sees as prose (spec 007 R4–R7): text for spell check, grammar
 * and word count; math for hover previews; everything else is markup.
 */

export type Range = { from: number; to: number };
/** A math span including its delimiters; `inner` is what KaTeX renders. */
export type MathRange = Range & { innerFrom: number; innerTo: number; display: boolean };
export type Readable = { text: Range[]; math: MathRange[]; markup: Range[] };
/** LanguageTool "annotated text" parts (research R5). */
export type AnnotatedPart = { text: string } | { markup: string; interpretAs?: string };

/** Commands whose arguments are keys, paths or code rather than prose. */
const SKIP_ARGS = new Set([
  "label", "ref", "eqref", "autoref", "cref", "Cref", "pageref", "nameref", "vref",
  "cite", "citep", "citet", "parencite", "textcite", "autocite", "footcite", "nocite", "citeauthor", "citeyear",
  "url", "includegraphics", "input", "include", "subfile", "import", "bibliography", "bibliographystyle",
  "addbibresource", "usepackage", "RequirePackage", "documentclass", "newcommand", "renewcommand",
  "providecommand", "DeclareMathOperator", "newenvironment", "renewenvironment", "def", "let", "setlength",
  "addtolength", "setcounter", "addtocounter", "hspace", "vspace", "color", "pagecolor",
  "definecolor", "graphicspath", "newtheorem", "setmainfont", "setsansfont", "setmonofont", "newfontfamily",
  "fontsize", "linespread", "geometry", "hypersetup", "lstset", "pagestyle", "thispagestyle", "pagenumbering",
  "bibitem", "ensuremath",
]);
/** Only the first argument is markup: `\href{url}{text}`, `\textcolor{red}{text}`. */
const SKIP_FIRST_ARG = new Set(["href", "textcolor", "colorbox"]);
const VERBATIM_ENVS = new Set(["verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment", "filecontents", "filecontents*"]);
const MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*", "multline", "multline*",
  "flalign", "flalign*", "eqnarray", "eqnarray*", "math", "displaymath",
]);
/** Environments whose `{…}` arguments after the name are column specs or sizes. */
const ENV_ARGS = new Set(["tabular", "tabular*", "tabularx", "array", "longtable", "minipage", "multicols", "wrapfigure", "subfigure"]);

const isLetter = (c: string | undefined) => !!c && /[A-Za-z@]/.test(c);

/** End of the balanced `{…}` group starting at `open` (exclusive), or the text end. */
function groupEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return text.length;
}

/** End of a `[…]` optional argument starting at `open`. */
function optionEnd(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "]" && depth === 0) return i + 1;
  }
  return text.length;
}

function skipSpaces(text: string, i: number): number {
  while (text[i] === " " || text[i] === "\t") i++;
  return i;
}

/** Skip `[…]` and (when `groups` > 0) up to that many `{…}` arguments after position `i`. */
function skipArgs(text: string, i: number, groups: number): number {
  for (;;) {
    const j = skipSpaces(text, i);
    if (text[j] === "[") i = optionEnd(text, j);
    else if (text[j] === "{" && groups > 0) {
      i = groupEnd(text, j);
      groups--;
    } else if (text[j] === "*" && groups > 0) i = j + 1;
    else return i;
  }
}

/** First unescaped `needle` at or after `from`, or -1. */
function findClose(text: string, needle: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    if (text.startsWith(needle, i)) return i;
    // `\$`, `\\` … are escaped characters, never a closing delimiter.
    if (text[i] === "\\") i++;
  }
  return -1;
}

/** Split LaTeX source into prose, math and markup ranges (in order, non-overlapping, covering the text). */
export function readableRanges(text: string): Readable {
  const result: Readable = { text: [], math: [], markup: [] };
  let textStart = -1;
  const flushText = (end: number) => {
    if (textStart >= 0 && end > textStart) result.text.push({ from: textStart, to: end });
    textStart = -1;
  };
  const markup = (from: number, to: number) => {
    flushText(from);
    if (to <= from) return;
    const last = result.markup[result.markup.length - 1];
    if (last && last.to === from) last.to = to;
    else result.markup.push({ from, to });
  };
  const math = (from: number, innerFrom: number, innerTo: number, to: number, display: boolean) => {
    flushText(from);
    result.math.push({ from, to, innerFrom, innerTo, display });
  };

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "%") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      markup(i, stop);
      i = stop;
    } else if (c === "$") {
      const display = text[i + 1] === "$";
      const delim = display ? "$$" : "$";
      const close = findClose(text, delim, i + delim.length);
      const innerTo = close < 0 ? text.length : close;
      const to = close < 0 ? text.length : close + delim.length;
      math(i, i + delim.length, innerTo, to, display);
      i = to;
    } else if (c === "\\") {
      const next = text[i + 1];
      if (next === "(" || next === "[") {
        const closer = next === "(" ? "\\)" : "\\]";
        const close = findClose(text, closer, i + 2);
        const innerTo = close < 0 ? text.length : close;
        const to = close < 0 ? text.length : close + 2;
        math(i, i + 2, innerTo, to, next === "[");
        i = to;
      } else if (isLetter(next)) {
        let j = i + 1;
        while (isLetter(text[j])) j++;
        const name = text.slice(i + 1, j);
        if (name === "begin" || name === "end") {
          const open = skipSpaces(text, j);
          const close = text[open] === "{" ? groupEnd(text, open) : open;
          const env = text.slice(open + 1, close - 1);
          if (name === "begin" && (VERBATIM_ENVS.has(env) || MATH_ENVS.has(env))) {
            const endTag = `\\end{${env}}`;
            const endAt = text.indexOf(endTag, close);
            const innerTo = endAt < 0 ? text.length : endAt;
            const to = endAt < 0 ? text.length : endAt + endTag.length;
            if (VERBATIM_ENVS.has(env)) markup(i, to);
            else math(i, close, innerTo, to, true);
            i = to;
          } else {
            const stop = name === "begin" ? skipArgs(text, close, ENV_ARGS.has(env) ? 2 : 0) : close;
            markup(i, stop);
            i = stop;
          }
        } else if (name === "verb" || name === "lstinline") {
          const delim = text[j];
          const end = delim ? text.indexOf(delim === "{" ? "}" : delim, j + 1) : -1;
          const stop = end < 0 ? text.length : end + 1;
          markup(i, stop);
          i = stop;
        } else {
          const groups = SKIP_ARGS.has(name) ? 3 : SKIP_FIRST_ARG.has(name) ? 1 : 0;
          // \newcommand{\x}[1]{…} and \def\x{…}: the macro name is a command too.
          let k = j;
          if ((name === "def" || name === "let") && text[k] === "\\") {
            k++;
            while (isLetter(text[k])) k++;
          }
          const stop = groups > 0 ? skipArgs(text, k, groups) : k;
          markup(i, stop);
          i = stop;
        }
      } else {
        // `\\`, `\%`, `\&`, `\,` … : one escaped character.
        markup(i, Math.min(i + 2, text.length));
        i += 2;
      }
    } else if ("{}&~^_#".includes(c)) {
      markup(i, i + 1);
      i++;
    } else {
      if (textStart < 0) textStart = i;
      i++;
    }
  }
  flushText(text.length);
  return result;
}

/** The math span containing `pos`, if any. */
export function mathAt(text: string, pos: number, ranges: Readable = readableRanges(text)): MathRange | null {
  return ranges.math.find((range) => pos >= range.from && pos < range.to) ?? null;
}

/** Annotated text for LanguageTool: prose as `text`, everything else as `markup` (math reads as "x"). */
export function annotate(text: string, ranges: Readable = readableRanges(text)): AnnotatedPart[] {
  const spans: { from: number; to: number; kind: "text" | "math" | "markup" }[] = [
    ...ranges.text.map((r) => ({ ...r, kind: "text" as const })),
    ...ranges.math.map((r) => ({ from: r.from, to: r.to, kind: "math" as const })),
    ...ranges.markup.map((r) => ({ ...r, kind: "markup" as const })),
  ].sort((a, b) => a.from - b.from);
  return spans.map((span) => {
    const slice = text.slice(span.from, span.to);
    if (span.kind === "text") return { text: slice };
    return span.kind === "math" ? { markup: slice, interpretAs: "x" } : { markup: slice };
  });
}

/** The prose with markup and math blanked to spaces, so offsets and line numbers stay the same. */
export function proseOnly(text: string, ranges: Readable = readableRanges(text)): string {
  const chars = text.replace(/[^\n]/g, " ").split("");
  for (const range of ranges.text) for (let i = range.from; i < range.to; i++) chars[i] = text[i];
  return chars.join("");
}
