import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE, escapeLatex, tableLatex, validateTable } from "./tables";

describe("tableLatex", () => {
  it("3x2 with borders and header", () => {
    const { latex } = tableLatex({ ...DEFAULT_TABLE, cols: 3, rows: 2 });
    expect(latex).toBe(
      ["\\begin{tabular}{|l|l|l|}", "  \\hline", "  &  & \\\\", "  \\hline", "  \\hline", "  &  & \\\\", "  \\hline", "\\end{tabular}"].join("\n"),
    );
  });

  it("borders off with a header row has a single rule under the header", () => {
    const { latex } = tableLatex({ ...DEFAULT_TABLE, borders: false, rows: 3, cols: 2 });
    expect(latex).toBe(["\\begin{tabular}{ll}", "  & \\\\", "  \\hline", "  & \\\\", "  & \\\\", "\\end{tabular}"].join("\n"));
  });

  it("no header, no borders: just rows", () => {
    const { latex } = tableLatex({ ...DEFAULT_TABLE, borders: false, header: false, rows: 1, cols: 1 });
    expect(latex).toBe("\\begin{tabular}{l}\n  \\\\\n\\end{tabular}");
  });

  it("applies column alignment", () => {
    expect(tableLatex({ ...DEFAULT_TABLE, align: "c" }).latex).toContain("{|c|c|}");
    expect(tableLatex({ ...DEFAULT_TABLE, align: "r", borders: false }).latex).toContain("{rr}");
  });

  it("wraps in a captioned table float and escapes the caption", () => {
    const { latex } = tableLatex({ ...DEFAULT_TABLE, caption: "Costs & 50% of #1_total {x}" });
    expect(latex.startsWith("\\begin{table}[h]\n  \\centering\n  \\begin{tabular}")).toBe(true);
    expect(latex).toContain("\\caption{Costs \\& 50\\% of \\#1\\_total \\{x\\}}");
    expect(latex.endsWith("\\end{table}")).toBe(true);
  });

  it("puts the cursor at the first cell", () => {
    for (const spec of [DEFAULT_TABLE, { ...DEFAULT_TABLE, caption: "c" }, { ...DEFAULT_TABLE, borders: false, cols: 1 }]) {
      const { latex, cursor } = tableLatex(spec);
      const lineStart = latex.lastIndexOf("\n", cursor - 1) + 1;
      expect(latex.slice(lineStart, cursor).trim()).toBe("");
      expect(latex.slice(cursor).startsWith("&") || latex.slice(cursor).startsWith("\\\\")).toBe(true);
    }
  });

  it.each([
    [0, 2],
    [51, 2],
    [2, 0],
    [2, 21],
    [1.5, 2],
  ])("rejects %s rows x %s cols", (rows, cols) => {
    expect(validateTable({ rows, cols })).not.toBeNull();
    expect(() => tableLatex({ ...DEFAULT_TABLE, rows, cols })).toThrow();
  });

  it("accepts the limits", () => {
    expect(validateTable({ rows: 50, cols: 20 })).toBeNull();
    expect(tableLatex({ ...DEFAULT_TABLE, rows: 50, cols: 20 }).latex.split("\\\\").length - 1).toBe(50);
  });
});

describe("escapeLatex", () => {
  it("escapes every special character exactly once", () => {
    expect(escapeLatex("\\ { } ~ ^")).toBe("\\textbackslash{} \\{ \\} \\textasciitilde{} \\textasciicircum{}");
    expect(escapeLatex("plain text")).toBe("plain text");
  });
});
