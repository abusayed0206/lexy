export const PLACEHOLDER = "□";

export type PaletteItem = { name: string; label: string; tex: string };
export type PaletteGroup = { group: string; items: PaletteItem[] };

const greek = (names: string[]): PaletteItem[] =>
  names.map((name) => ({ name, label: `\\${name}`, tex: `\\${name}` }));

export const PALETTE: PaletteGroup[] = [
  {
    group: "Structures",
    items: [
      { name: "Fraction", label: "a/b", tex: "\\frac{□}{□}" },
      { name: "Square root", label: "√x", tex: "\\sqrt{□}" },
      { name: "Nth root", label: "ⁿ√x", tex: "\\sqrt[□]{□}" },
      { name: "Superscript", label: "xⁿ", tex: "{□}^{□}" },
      { name: "Subscript", label: "xₙ", tex: "{□}_{□}" },
      { name: "Sum", label: "∑", tex: "\\sum_{□}^{□}" },
      { name: "Product", label: "∏", tex: "\\prod_{□}^{□}" },
      { name: "Integral", label: "∫", tex: "\\int_{□}^{□} □ \\,d□" },
      { name: "Limit", label: "lim", tex: "\\lim_{□ \\to □}" },
      { name: "Matrix 2x2", label: "2×2", tex: "\\begin{pmatrix} □ & □ \\\\ □ & □ \\end{pmatrix}" },
      {
        name: "Matrix 3x3",
        label: "3×3",
        tex: "\\begin{pmatrix} □ & □ & □ \\\\ □ & □ & □ \\\\ □ & □ & □ \\end{pmatrix}",
      },
    ],
  },
  {
    group: "Greek",
    items: greek([
      "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu",
      "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
      "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
    ]),
  },
  {
    group: "Relations",
    items: [
      { name: "Less or equal", label: "≤", tex: "\\le" },
      { name: "Greater or equal", label: "≥", tex: "\\ge" },
      { name: "Not equal", label: "≠", tex: "\\neq" },
      { name: "Approximately", label: "≈", tex: "\\approx" },
      { name: "Equivalent", label: "≡", tex: "\\equiv" },
      { name: "Element of", label: "∈", tex: "\\in" },
      { name: "Subset", label: "⊂", tex: "\\subset" },
    ],
  },
  {
    group: "Operators",
    items: [
      { name: "Plus minus", label: "±", tex: "\\pm" },
      { name: "Times", label: "×", tex: "\\times" },
      { name: "Divide", label: "÷", tex: "\\div" },
      { name: "Dot", label: "·", tex: "\\cdot" },
      { name: "Infinity", label: "∞", tex: "\\infty" },
      { name: "Partial", label: "∂", tex: "\\partial" },
      { name: "Nabla", label: "∇", tex: "\\nabla" },
    ],
  },
  {
    group: "Arrows",
    items: [
      { name: "Right arrow", label: "→", tex: "\\to" },
      { name: "Implies", label: "⇒", tex: "\\Rightarrow" },
      { name: "If and only if", label: "⇔", tex: "\\Leftrightarrow" },
      { name: "Maps to", label: "↦", tex: "\\mapsto" },
    ],
  },
];

/** Index of the next placeholder at or after `from`, wrapping to the start; -1 if none. */
export function nextPlaceholder(text: string, from: number): number {
  const ahead = text.indexOf(PLACEHOLDER, from);
  return ahead >= 0 ? ahead : text.indexOf(PLACEHOLDER);
}

export type EquationMode = "inline" | "display";
export type Delimiter = "parens" | "dollar" | "brackets" | "double-dollar" | "equation" | "equation*" | "align" | "align*";

export type FoundEquation = { from: number; to: number; tex: string; mode: EquationMode; delimiter: Delimiter };

const INLINE_DELIMITERS: Delimiter[] = ["parens", "dollar"];

/** Placeholders never reach the document: pdfLaTeX can't typeset "□". */
function clean(tex: string): string {
  return tex.split(PLACEHOLDER).join("").trim();
}

/** LaTeX for an equation; keeps the original delimiter when editing in the same mode. */
export function wrapEquation(tex: string, mode: EquationMode, original?: Delimiter): string {
  const body = clean(tex);
  const delimiter =
    original && INLINE_DELIMITERS.includes(original) === (mode === "inline") ? original : mode === "inline" ? "parens" : "equation";
  switch (delimiter) {
    case "parens":
      return `\\(${body}\\)`;
    case "dollar":
      return `$${body}$`;
    case "brackets":
      return `\\[\n  ${body}\n\\]`;
    case "double-dollar":
      return `$$${body}$$`;
    default:
      return `\\begin{${delimiter}}\n  ${body}\n\\end{${delimiter}}`;
  }
}

const PATTERNS: { regex: RegExp; delimiter: (match: RegExpExecArray) => Delimiter; body: number }[] = [
  {
    regex: /\\begin\{(equation\*?|align\*?)\}([\s\S]*?)\\end\{\1\}/g,
    delimiter: (match) => match[1] as Delimiter,
    body: 2,
  },
  { regex: /\\\[([\s\S]*?)\\\]/g, delimiter: () => "brackets", body: 1 },
  { regex: /\\\(([\s\S]*?)\\\)/g, delimiter: () => "parens", body: 1 },
  { regex: /(?<!\\)\$\$([\s\S]+?)\$\$/g, delimiter: () => "double-dollar", body: 1 },
  { regex: /(?<![\\$])\$(?!\$)((?:\\.|[^$\\])+?)\$/g, delimiter: () => "dollar", body: 1 },
];

/** The equation surrounding `pos` (inclusive of its delimiters), or null. */
export function findEquationAt(doc: string, pos: number): FoundEquation | null {
  for (const { regex, delimiter, body } of PATTERNS) {
    regex.lastIndex = 0;
    for (let match = regex.exec(doc); match; match = regex.exec(doc)) {
      const from = match.index;
      const to = from + match[0].length;
      if (from <= pos && pos <= to) {
        const kind = delimiter(match);
        return {
          from,
          to,
          tex: match[body].trim(),
          mode: INLINE_DELIMITERS.includes(kind) ? "inline" : "display",
          delimiter: kind,
        };
      }
      if (from > pos) break;
    }
  }
  return null;
}
