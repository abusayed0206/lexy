# Contract: Ribbon, dialogs and editor actions

## Ribbon tabs (WAI-ARIA tabs)

`role="tablist"` labelled "Ribbon". Left/Right arrow moves between tabs, Home/End jump, Enter/Space or focus activates. The active tab is remembered (`lexy.ribbonTab`); the default is Home. Each panel is a `role="tabpanel"` containing `role="group"` sections, each with an `aria-label`.

| Tab | Group | Control | Kind | Action (all are one undo step) | Shortcut |
| --- | --- | --- | --- | --- | --- |
| File | Document | New, Open, Save, Save as | buttons | existing commands | Ctrl+N/O/S, Ctrl+Shift+S |
| Home | Font | Font family | combobox (built-in list, separator, "Installed fonts" filterable) | `applySettings(font)` | — |
| Home | Font | Size | select 10/11/12 | `applySettings(size)` | — |
| Home | Font | Bold / Italic / Underline | buttons | wrap selection `\textbf{}` / `\textit{}` / `\underline{}`; empty → insert with cursor inside | Ctrl+B / Ctrl+I / Ctrl+U |
| Home | Paragraph | Bullets / Numbering | buttons | selected lines → `itemize` / `enumerate` with `\item` each; current line if none | — |
| Home | Styles | Normal, Heading 1, Heading 2, Heading 3 | menu | current line → plain / `\section{}` / `\subsection{}` / `\subsubsection{}` (unwraps an existing one first) | — |
| Insert | Math | Equation | button → dialog | see below | — |
| Insert | Tables | Table | split button: grid picker + "Insert table…" | see below | — |
| Insert | Pages | Page break | button | insert `\newpage` on its own line | — |
| Insert | References | Footnote | button | wrap the selection in `\footnote{}` (cursor inside when empty) | — |
| Layout | Page setup | Margins | menu: Normal, Narrow, Moderate, Wide, Custom… | `applySettings(margins)` | — |
| Layout | Page setup | Size | menu: A4, Letter | `applySettings(paper)` | — |
| Layout | Page setup | Orientation | menu: Portrait, Landscape | `applySettings(orientation)` | — |
| View | Preview | Live preview | toggle (`aria-pressed`) | enable/disable scheduler | — |
| View | Preview | Compile now | button | explicit compile | F5 |
| View | Output | Show/Hide logs | toggle | drawer | Ctrl+L |

The Compile button and status pill stay visible at the right of the tab row on every tab.

Responsive: ≥ 900 px wide shows icons with labels under them; < 900 px shows icons only, with tooltips; < 820 px also hides the group captions. Nothing wraps or overlaps at 800 px.

## Equation dialog (`role="dialog"`, `aria-modal`, labelled "Equation")

- Focus starts in the math field; Esc or Cancel closes with no change.
- Palette: buttons with accessible names ("Fraction", "Square root", "alpha", …). Clicking one inserts its snippet and selects the first `□`; Tab moves to the next `□`.
- Preview region (`aria-live="polite"`): the rendered equation, or "Can't preview: <KaTeX message>".
- Mode: Inline / Display radio (defaults to Display, or to the mode of the equation being edited).
- Insert (Enter with Ctrl): inline → `\(TEX\)`; display → `\begin{equation}\n  TEX\n\end{equation}` on its own lines. When editing, replaces the found range.

## Table picker and dialog

- Grid 10 × 8 cells, arrow-key navigable, caption text "C x R Table"; click or Enter inserts.
- "Insert table…" dialog fields: Columns (1–20), Rows (1–50), Header row, Borders, Alignment (Left/Center/Right), Caption. Invalid numbers show inline errors and disable Insert.

## Custom margins dialog

Four number fields in cm (0.5–6, step 0.01), prefilled from current settings. Invalid fields show inline errors and disable Apply.

## Status area

- Live compile failure: the status pill shows "Preview failed" and the tooltip/one-line text shows the summary; the drawer does not open.
- Explicit compile failure: existing behaviour (drawer opens).
- Fallback folder notice (FR-003): dismissible alert "Saving to <home> because Documents isn't available."

Note: table cells are inserted empty (cursor in the first cell), not as `□`, so the document keeps compiling during live preview.
