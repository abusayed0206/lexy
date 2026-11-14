# Contract: Lexy settings block in `.tex` files

This is a public format: other LaTeX editors will compile it, and later Lexy versions must keep reading it.

## Shape

```latex
% !TEX program = xelatex                       <- line 1, only when a system font is chosen
\documentclass[11pt]{article}                  <- size option managed by Lexy; other options kept
% --- Lexy settings (edited by Lexy's Home and Layout tabs) ---
\usepackage[a4paper,portrait,top=2.54cm,bottom=2.54cm,left=1.91cm,right=1.91cm]{geometry}
\usepackage{newpxtext,newpxmath}
% --- end Lexy settings ---
...rest of the user's preamble, untouched...
```

## Rules

1. **Markers** are exact lines: `% --- Lexy settings (edited by Lexy's Home and Layout tabs) ---` and `% --- end Lexy settings ---`. Matching is on the prefixes `% --- Lexy settings` and `% --- end Lexy settings`.
2. **Position**: immediately after the `\documentclass…` line when first created. An existing block is rewritten in place, wherever it is.
3. **Contents** (in order): exactly one `geometry` line, then the font lines from research R3 (pdfLaTeX) or `\usepackage{fontspec}` + `\setmainfont{<Family>}` (XeLaTeX). Nothing else.
4. **Geometry**: `<paper>paper,<orientation>,top=…cm,bottom=…cm,left=…cm,right=…cm`, values with up to 2 decimals, no trailing zeros beyond 2 places.
5. **Class size**: `10pt|11pt|12pt` inside `\documentclass[…]`. Lexy replaces an existing `\d+pt` option or appends one; 10pt is written explicitly once the user picks it.
6. **Engine marker**: `% !TEX program = xelatex` is inserted as line 1 for system fonts and removed (only that exact Lexy-written form) when switching back to a built-in font.
7. **Never** touches lines outside rules 2–6. If the user deleted one marker, Lexy treats the block as absent and writes a new one (the orphan marker stays; parse uses the first complete block).
8. **Parsing** unknown content inside the block: unknown lines are dropped on the next rewrite (the block is Lexy-owned and labelled as such).

## Examples (golden files for tests)

- No block, `\documentclass{article}` + Times + Narrow + A4 → class `[10pt]`, block with `margin`s 1.27 and `newtxtext,newtxmath`.
- Block present with Georgia (system) → line-1 marker present; switching to Latin Modern removes the marker and `fontspec` lines.
- `\documentclass[twocolumn,12pt]{report}` + size 11 → `[twocolumn,11pt]`.
