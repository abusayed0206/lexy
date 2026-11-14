# Research: Live Preview, PDF ↔ Source Sync, Actionable Errors (003)

No NEEDS CLARIFICATION remained. Decisions below.

## R1. Location data: SyncTeX via the engines
- **Decision**: Pass `-synctex=1` to latexmk; it reaches pdflatex/xelatex through `%O` in Lexy's `-pdflatex=`/`-xelatex=` commands. Output: `<build>\<stem>.synctex.gz`.
- **Rationale**: Every LaTeX editor uses this standard; it costs a few percent of compile time and needs no new tool.
- **Alternatives**: Parse PDF text and fuzzy-match the source: unreliable for math and macros.

## R2. Lookups: MiKTeX `synctex.exe`, not a Rust parser
- **Decision**: Resolve `synctex.exe` beside the resolved `pdflatex.exe` (same MiKTeX bin folder). Call it through `run_with_timeout` (5 s, hidden console):
  - PDF → source: `synctex edit -o <page>:<x>:<y>:<pdf>`. Parse the `Input:` and `Line:` lines.
  - Source → PDF: `synctex view -i <line>:0:<input> -o <pdf>`. Parse the first `Page:`, `h:`, `v:`, `W:`, `H:`.
  - Coordinates are PDF points from the page's top-left (72 per inch). `v` is the baseline, so the box spans `v-H` to `v`.
- **Input names**: TeX records the path it opened, which can be the snapshot `<build>\<stem>.tex`, the overlay `<build>\.lexy-overlay\<rel>`, `<project>\<rel>` or the junction `<build>\.lexy-root\<rel>`, with either slash. `sync_to_pdf` tries those candidates in that order; the first hit wins (≤ 4 calls ≈ 200 ms worst case, SC-002).
- **Rationale**: No new crate (a Rust parser would need `flate2` plus a format parser); the CLI ships with every MiKTeX install that Lexy itself installs.
- **Alternatives**: A `synctex` parser crate (none maintained); a WASM SyncTeX parser in the frontend (it would read build files from React, breaking the boundary rule).

## R3. The "shown" slot keeps lookups and the PDF consistent
- **Decision**: After a successful compile, copy `<stem>.pdf` and `<stem>.synctex.gz` to `<build>\.lexy-shown\<stem>.*` (atomic: write to temp names, then rename) and return that PDF path. Failed compiles never touch the slot. Lookups always read the slot, so they match the PDF on screen (FR-004, FR-013). The path table (snapshot path → main, overlay → rel, project/junction → rel) for that compile is kept in managed `SyncState` keyed by build folder.
- **Rationale**: latexmk with `-halt-on-error` can delete or half-write the PDF and SyncTeX file on failure; a copy is cheap (≤ a few MB).
- Export (`export_pdf`) keeps its rule: it exports the last good PDF, now from the slot.

## R4. Problems from the log
- **Decision**: Add `-max-print-line=1000` to the MiKTeX engine commands so log lines don't wrap at 79 characters. Then parse in Rust:
  - Track the file stack from `(path` / `)` tokens.
  - Errors: `path:line: message` lines (from `-file-line-error`) and `! message` lines with a later `l.<n>` line (file = top of the stack).
  - Warnings: `LaTeX Warning: … on input line N.`, `Package X Warning: … on input line N.` (including continuation lines starting with `(X)`), `Overfull/Underfull \hbox … at lines A--B` → line A, and `LaTeX Warning: Citation/Reference … undefined`.
  - Missing-file and font errors keep the existing summaries with `line: None`.
  - Cap at 200 problems and de-duplicate (file, line, message).
- **Path mapping**: the same table as R3. Paths outside the project (class/package files) become `file: None` with the name in the message.
- **Alternatives**: the `texlogparser`-style JS libraries (new dependency; React would see build paths).

## R5. Inline markers: `@codemirror/lint`
- **Decision**: `setDiagnostics` per open file's `EditorState` (the Editor keeps one state per file). Severity is error/warning, the range is the whole line, gutter markers come from `lintGutter()`, messages show on hover. Diagnostics map through later edits automatically. Add `@codemirror/lint` to `package.json` at the version already installed.
- **Rationale**: the official CodeMirror package, already in the lockfile through `codemirror`.

## R6. Problems list
- **Decision**: A "Problems (N)" tab in the existing log drawer, next to the raw log, plus a count in the status chip. A live failure updates the markers and the count but never opens the drawer (keeps the existing rule). An explicit compile failure opens the drawer on Problems.

## R7. Zoom and position keeping
- **Decision**: `PdfView` gets `zoom: "fit" | number` (0.5–3 in 0.1 steps; steps 50/75/100/125/150/200/300 %), set with ribbon buttons, Ctrl+wheel over the preview, and Ctrl+= / Ctrl+- / Ctrl+0 while the preview has focus. Re-render on a new PDF keeps the zoom. Scroll is kept by anchor: the page number plus the fraction into that page (more robust than raw `scrollTop` when page heights change). Zoom is remembered per window in `localStorage`.
- Rendering: render the visible pages first, then the rest in the background, so updates feel instant on long documents.
- **Rationale**: Today the preview always fits the width, so "zoom resets" is really "no zoom"; the anchor rule fixes the drift when pages grow.

## R8. Gestures
- **Decision**: Double-click (not a single click) on the PDF jumps to the source, as in Overleaf and TeXstudio. A single click must keep working for focus, scrolling and text selection, and Lexy's PDF has no text layer anyway. Ctrl+J jumps from source to PDF (View tab: "Show in PDF"). The target line flashes for 1 s (an editor line decoration), and the PDF spot gets a 1 s translucent box (an absolutely positioned div over the page).
- **Cross-file**: a target in another project file opens it through the Writer's existing `onEntryOpen`, then jumps. External files only get a status message (FR-005).

## R9. Stale lines
- **Decision**: Jumps use the shown compile's line numbers (spec edge case). Lexy clamps to the document length and never blocks. No position mapping through edits, apart from what `@codemirror/lint` does for markers.

## R10. Live preview timing
- **Decision**: Keep the 1 s pause and the "one running + one queued" scheduler (it already meets "short pause, background"). No change beyond feeding `problems` to the UI.
