import { describe, expect, it } from "vitest";
import { findEquationAt, nextPlaceholder, PALETTE, PLACEHOLDER, wrapEquation } from "./equations";

describe("palette", () => {
  const items = PALETTE.flatMap((group) => group.items);

  it("covers the groups the spec requires", () => {
    expect(PALETTE.map((group) => group.group)).toEqual(["Structures", "Greek", "Relations", "Operators", "Arrows"]);
    for (const name of ["Fraction", "Square root", "Nth root", "Superscript", "Subscript", "Sum", "Product", "Integral", "Limit", "Matrix 2x2", "Matrix 3x3"]) {
      expect(items.some((item) => item.name === name)).toBe(true);
    }
  });

  it("gives every item a unique name, a label and TeX", () => {
    expect(new Set(items.map((item) => item.name)).size).toBe(items.length);
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.tex.length).toBeGreaterThan(0);
    }
  });

  it("uses placeholders for every slot in structures", () => {
    for (const item of PALETTE[0].items) expect(item.tex).toContain(PLACEHOLDER);
  });
});

describe("nextPlaceholder", () => {
  it("finds the next one and wraps around", () => {
    const text = "\\frac{□}{□}";
    expect(nextPlaceholder(text, 0)).toBe(6);
    expect(nextPlaceholder(text, 7)).toBe(9);
    expect(nextPlaceholder(text, 10)).toBe(6);
    expect(nextPlaceholder("none", 0)).toBe(-1);
  });
});

describe("wrapEquation", () => {
  it("inline uses \\( \\) and display uses a numbered equation", () => {
    expect(wrapEquation("a+b", "inline")).toBe("\\(a+b\\)");
    expect(wrapEquation("a+b", "display")).toBe("\\begin{equation}\n  a+b\n\\end{equation}");
  });

  it("strips leftover placeholders so the document still compiles", () => {
    expect(wrapEquation("\\frac{a}{□}", "inline")).toBe("\\(\\frac{a}{}\\)");
  });

  it("keeps the original delimiter when editing in the same mode", () => {
    expect(wrapEquation("x", "inline", "dollar")).toBe("$x$");
    expect(wrapEquation("x", "display", "align*")).toBe("\\begin{align*}\n  x\n\\end{align*}");
    expect(wrapEquation("x", "display", "brackets")).toBe("\\[\n  x\n\\]");
  });

  it("switches to the standard delimiter when the mode changes", () => {
    expect(wrapEquation("x", "display", "dollar")).toBe("\\begin{equation}\n  x\n\\end{equation}");
    expect(wrapEquation("x", "inline", "equation")).toBe("\\(x\\)");
  });
});

describe("findEquationAt", () => {
  it.each([
    ["a \\(x^2\\) b", 5, "x^2", "inline", "parens"],
    ["a $x^2$ b", 4, "x^2", "inline", "dollar"],
    ["a \\[ y \\] b", 5, "y", "display", "brackets"],
    ["a $$ z $$ b", 5, "z", "display", "double-dollar"],
    ["\\begin{equation}\n  E=mc^2\n\\end{equation}", 20, "E=mc^2", "display", "equation"],
    ["\\begin{align*}a&=b\\end{align*}", 15, "a&=b", "display", "align*"],
  ] as const)("finds %j at %s", (doc, pos, tex, mode, delimiter) => {
    expect(findEquationAt(doc, pos)).toMatchObject({ tex, mode, delimiter });
  });

  it("returns the full range including delimiters", () => {
    const doc = "pre \\(x\\) post";
    expect(findEquationAt(doc, 6)).toMatchObject({ from: 4, to: 9 });
  });

  it("treats the delimiters themselves as inside", () => {
    expect(findEquationAt("\\(x\\)", 0)).not.toBeNull();
    expect(findEquationAt("\\(x\\)", 5)).not.toBeNull();
  });

  it("returns null outside equations", () => {
    expect(findEquationAt("a \\(x\\) b", 9)).toBeNull();
    expect(findEquationAt("costs \\$5 and \\$6", 8)).toBeNull();
  });

  it("handles nested braces and picks the right one of several", () => {
    const doc = "$a$ and $\\frac{1}{\\sqrt{2}}$";
    expect(findEquationAt(doc, 12)?.tex).toBe("\\frac{1}{\\sqrt{2}}");
    expect(findEquationAt(doc, 1)?.tex).toBe("a");
  });
});
