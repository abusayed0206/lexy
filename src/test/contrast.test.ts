/**
 * Text contrast of the theme tokens in App.css (DESIGN.md "Windows design alignment"):
 * ≥ 4.5:1 for text, ≥ 3:1 for large/non-essential text, borders and focus indicators.
 */
import { describe, expect, it } from "vitest";

// CSS imports are stubbed in Vitest, so read the file itself. Vitest runs from the project root;
// the module name is a variable because the project has no Node type definitions.
const fsModule = "node:fs";
const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: string, encoding: "utf8") => string };
const css = readFileSync("src/App.css", "utf8");

/** Custom properties declared directly in the block that starts at `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start + selector.length + 2, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-2"],
  ["text", "editor-bg"],
  ["text-muted", "bg"],
  ["text-muted", "surface"],
  ["text-muted", "editor-bg"],
  ["danger-text", "danger-bg"],
  ["warn-text", "warn-bg"],
  ["ok-text", "ok-bg"],
  ["accent-text", "accent"],
  ["syntax-command", "editor-bg"],
  ["syntax-environment", "editor-bg"],
  ["syntax-math", "editor-bg"],
];
const LARGE_OR_UI_PAIRS: [string, string][] = [
  ["text-faint", "editor-bg"],
  ["accent", "bg"],
  ["accent", "surface"],
  ["control-border", "surface"],
  ["control-border", "bg"],
  ["syntax-comment", "editor-bg"],
];

const themes = { light: tokens(":root"), dark: tokens(':root[data-theme="dark"]') };

describe.each(Object.entries(themes))("%s theme contrast", (_name, theme) => {
  it.each(TEXT_PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(theme[fg], theme[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(LARGE_OR_UI_PAIRS)("%s on %s is at least 3:1", (fg, bg) => {
    expect(contrast(theme[fg], theme[bg])).toBeGreaterThanOrEqual(3);
  });
});

describe("contrast()", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});
