export type TableSpec = {
  rows: number;
  cols: number;
  header: boolean;
  borders: boolean;
  align: "l" | "c" | "r";
  caption: string;
};

export const MAX_ROWS = 50;
export const MAX_COLS = 20;

export const DEFAULT_TABLE: TableSpec = { rows: 2, cols: 2, header: true, borders: true, align: "l", caption: "" };

/** Null when valid, otherwise a message for the dialog. */
export function validateTable({ rows, cols }: Pick<TableSpec, "rows" | "cols">): string | null {
  if (!Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) return `Rows must be between 1 and ${MAX_ROWS}`;
  if (!Number.isInteger(cols) || cols < 1 || cols > MAX_COLS) return `Columns must be between 1 and ${MAX_COLS}`;
  return null;
}

const SPECIALS: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

export function escapeLatex(text: string): string {
  return [...text].map((char) => SPECIALS[char] ?? char).join("");
}

/**
 * LaTeX for an empty table plus the offset of the first cell (where the cursor goes).
 * Cells are left empty so the document keeps compiling during live preview.
 */
export function tableLatex(spec: TableSpec): { latex: string; cursor: number } {
  const problem = validateTable(spec);
  if (problem) throw new Error(problem);

  const columns = spec.borders ? `|${Array(spec.cols).fill(spec.align).join("|")}|` : spec.align.repeat(spec.cols);
  const row = Array(spec.cols).fill("").join(" & ").trim();
  const rowLine = `${row ? `${row} ` : ""}\\\\`;
  const indent = spec.caption ? "    " : "  ";

  const lines = [`\\begin{tabular}{${columns}}`];
  if (spec.borders) lines.push(`${indent}\\hline`);
  for (let index = 0; index < spec.rows; index++) {
    lines.push(`${indent}${rowLine}`);
    if (spec.borders) lines.push(`${indent}\\hline`);
    if (index === 0 && spec.header && spec.rows > 1) lines.push(`${indent}\\hline`);
  }
  lines.push("\\end{tabular}");

  let latex: string;
  if (spec.caption) {
    const inner = lines.map((line, index) => (index === 0 || index === lines.length - 1 ? `  ${line}` : line));
    latex = ["\\begin{table}[h]", "  \\centering", ...inner, `  \\caption{${escapeLatex(spec.caption)}}`, "\\end{table}"].join("\n");
  } else {
    latex = lines.join("\n");
  }
  // First cell = start of the first data row's text.
  const firstRow = latex.indexOf(`${indent}${rowLine}`);
  return { latex, cursor: firstRow + indent.length };
}
