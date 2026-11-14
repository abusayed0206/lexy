# Quickstart: Writing Toolkit validation

Prerequisites: MiKTeX, latexmk and Perl installed (first-run setup done); Git for Windows for E; network for D (DOI) and G (Pandoc). Run `npm run tauri dev`. Each batch's automated gate is in `tasks.md`; this file is the manual walk in the native window at 800x600 and at a normal size, in light and dark (W also in a Windows contrast theme).

Sample project: create a project "Toolkit test" with `main.tex` that `\input{chapters/one}` and `\include{chapters/two}`, a `references.bib` with two entries, and a `\label{sec:intro}` in `chapters/one.tex`.

## A. Writing aids (US1)

1. Type `\sec` → the list shows `\section{}`; Enter inserts it with the cursor inside the braces.
2. Type `\begin{itemize}` + Enter → `\end{itemize}` appears below, cursor indented between. Rename `itemize` to `enumerate` in the begin → the end follows. Ctrl+Z undoes each in one step.
3. Type `\ref{` → `sec:intro` with its heading; `\cite{` → both bib keys with title and author.
4. Write "teh \textbf{bold} $x^2$ https://example.com" → only "teh" is underlined; right-click → "the" fixes it; "Add to dictionary" removes the mark for a made-up word and survives a restart.
5. A Bangla line is never underlined.
6. Status bar shows the project word count; select a sentence → "N of M words".
7. Hover `$\frac{a}{b}$` → rendered fraction after ~0.3 s; hover `$\frac{a$` → an error message.
8. Mess up indentation inside nested environments and a `verbatim` block, press Shift+Alt+F → environments re-indented, verbatim unchanged; one Ctrl+Z restores.
9. F7 with grammar off → dialog naming the server; turn on → issues underlined with fixes; commands not flagged.

## B. Navigation (US2)

1. Ctrl+Shift+O → Outline lists sections from all three files in order plus figures/tables; click a subsection in `two.tex` → it opens there. Edit a heading → the outline updates within 2 s.
2. Open three files → three tabs; Ctrl+Tab cycles; drag to reorder; Ctrl+W on an unsaved tab asks Save / Don't save / Cancel; closing the active tab selects the next.
3. Fold a section and an environment from the gutter; unfold; the file is not marked unsaved.
4. Ctrl+Shift+P, type "table" → Insert table with its shortcut; Enter runs it.
5. Ctrl+Shift+F "intro", whole word → grouped results; Replace all with "Intro" → affected files open as unsaved tabs; Ctrl+Z in one reverts that file only; Ctrl+S saves all.
6. F11 → only editor (and PDF) remain; F11 restores.
7. Settings → Vim keys on → `dd`, `u`, `i`, visual mode work; status shows the mode; Lexy shortcuts (F5, Ctrl+S) still work.

## C. Files and safety (US5)

1. Right-click `chapters/one.tex` → Duplicate → `one (copy).tex`; again → `one (copy 2).tex`. Copy the `chapters` folder, Paste on the root → `chapters (copy)`.
2. Settings → Auto-save on (5 s): type, wait → the unsaved dot clears. A read-only second window never saves.
3. In a project without Git: save twice 10+ min apart (or with the test clock) → File → History lists snapshots; restore one → text appears as an unsaved change; Ctrl+Z undoes it. In a Git project no snapshots are taken.

## D. Content (US3)

1. Insert → Citation → search an author → insert two keys → `\cite{a,b}`; compile → references appear.
2. Add by DOI `10.1038/nphys1170` → preview → Add → entry in `references.bib` with a unique key. Offline → "Could not fetch this DOI", nothing added.
3. Drop a PNG on the editor → copied to `figures/` (a second drop → "name (2).png"), figure block inserted, `\usepackage{graphicx}` added once.
4. New project → Letter → compiles unchanged. Repeat for each template.

## E. Review (US4)

1. Select a phrase → Ctrl+Alt+M "check this" → highlight + Notes list entry. Edit text before it, save, reopen → the note still covers the phrase.
2. Resolve → hidden unless "Show resolved". Delete the noted text → note shows "Text was removed".
3. Review → Export PDF with notes → `main (notes).pdf` has a margin note; the normal PDF has none.
4. Commit, change a paragraph, Review → Compare with last commit → insertions highlighted, deletions struck through; Close comparison returns to editing.

## F. Settings (US6)

Each setting changes behaviour immediately (theme, font size, preview delay, auto-save, Vim, spelling, grammar, image folder) and survives a restart; a second window picks changes up on focus.

## G. Export (US7)

First Export → Word: consent dialog with size → Download → progress → `main.docx` beside `main.tex`; it opens in Word with headings, a table, an image and an equation. Export → HTML → `main.html` with rendered math. A document with TikZ → export finishes with "1 part was approximated" and details.

## W. Windows alignment

1. Every dialog: primary button left, Cancel right; Enter = primary, Esc = Cancel; initial focus not on a destructive button.
2. Notices (missing folder, stale preview, Bangla offer, read-only) appear as InfoBars with icon + text.
3. F6 cycles ribbon → sidebar → editor → PDF → drawer; Shift+F6 reverses.
4. Windows Settings → Accessibility → Contrast themes → Night sky: all borders, focus rings, selections and problem markers stay visible.
5. Text at 14 px body; nothing below 12 px; all UI text in sentence case.
