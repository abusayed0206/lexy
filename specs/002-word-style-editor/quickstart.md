# Quickstart: validate the Word-style writing experience

## Prerequisites

- Windows with MiKTeX (pdfLaTeX + XeLaTeX), latexmk and Strawberry Perl. The setup screen shows all three Installed.
- MiKTeX allowed to install missing packages on the fly (first use of `newpx*`, `XCharter`, `libertine` or `fontspec` may download them).
- `npm install`; Rust toolchain.

## Automated checks

```powershell
npm test
npm run build
cd src-tauri; cargo test
```

Expected:
- All pass.
- The Rust e2e test compiles three things: a pdfLaTeX doc, a XeLaTeX doc with `\setmainfont{Arial}`, and a live snapshot that `\input`s a file next to a saved document (proves the `TEXINPUTS` route, research R5).
- Settings round-trip tests cover every font × margin preset × paper (SC-005).

## Run

```powershell
npm run tauri dev
```

## Scenarios

1. **Default folder (US2)**: rename or remove `Documents\Lexy` if present. Press Ctrl+S on the new document. The dialog opens in `Documents\Lexy` (now created) with `Untitled.tex`. Open (Ctrl+O) also starts there. On a OneDrive-redirected profile the folder is under OneDrive\Documents.
2. **Live preview (US1)**: type a sentence and stop. The preview updates within about 3 s, without saving: the unsaved dot stays and the file on disk is unchanged. Scroll to page 2 of a longer doc and type again: the preview stays on page 2 with no white flash. Type `\foo`: the status shows "Preview failed" and the last good PDF stays, with no drawer. Press F5: the drawer opens with the error. View → Live preview off: typing no longer compiles.
3. **Coalescing (SC-002)**: hold a key for 20 s. The logs show compiles strictly one after another, and the final preview matches the final text.
4. **Ribbon (US3)**: Home/Insert/Layout/View tabs switch with the mouse and with Left/Right arrows. Select a word and press Ctrl+B, which wraps it in `\textbf{}` (one Ctrl+Z undoes it). Heading 1 on a line gives `\section{…}`. Bullets on three lines gives `itemize`. At 800x600 the labels hide and nothing overlaps.
5. **Fonts (US4)**: pick Palatino and the preview changes; the settings block appears after `\documentclass` ([contracts/settings-block.md](contracts/settings-block.md)). Pick Installed fonts → Georgia: line 1 becomes `% !TEX program = xelatex` and the preview shows Georgia. Back to Latin Modern: the marker is removed. Size 12 gives `\documentclass[12pt]{article}`.
6. **Equations (US5)**: Insert → Equation, click Fraction, type `a`, Tab, `b`. The preview renders a/b. Choose Display and Insert to get an `equation` environment. Put the cursor inside it and open Equation again: it is loaded for editing, and Insert replaces it. Type `\frac{` to see "Can't preview", while Insert stays enabled.
7. **Margins (US6)**: Layout → Margins → Narrow, and the text block widens. Custom with left 0.2 shows an inline error and Apply disabled; left 3 applies. Paper → Letter and Orientation → Landscape change the page.
8. **Tables (US7)**: Insert → Table, hover 3×2 ("3 x 2 Table"), click to insert a 3-column, 2-row bordered table. Insert table… with Borders off, Header on and caption "Results" gives a `table` float with a caption.
9. **Conflicts (edge case)**: open a document that already has `\usepackage[margin=1in]{geometry}` and change the margins. A one-time warning appears and the user's line is untouched.
10. **Keyboard and accessibility (SC-006)**: tab through the ribbon. Every control has a name (check the accessibility tree), and the dialogs trap focus and close on Esc.

## Done

All scenarios pass. Record results in the `docs/TRACKER.md` Verification Log. Update F-007 (auto compile), F-018 (preview), F-033 (settings) and the new rows for ribbon, fonts, equations, tables, margins and default folder. Update `docs/DESIGN.md` for the ribbon direction.
