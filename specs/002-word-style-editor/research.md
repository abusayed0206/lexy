# Research: Word-Style Writing Experience

All Technical Context unknowns are resolved below. Library facts were checked against current docs (Context7) where available.

## R1 — "Like MS Word": ribbon over source, not WYSIWYG

- **Decision**: A Word-style ribbon (File/Home/Insert/Layout/View) above the existing source editor + live PDF preview. Every ribbon action edits LaTeX text.
- **Rationale**: Keeps Lexy a LaTeX writer (PLAN principle 2) and keeps files portable. Live preview delivers most of the "see it as you write" feel.
- **Alternatives considered**: A WYSIWYG rich-text editor that converts to LaTeX was rejected. Round-tripping arbitrary LaTeX is unsolved, and it is a different product. A visual-markup mode (rendered widgets inside CodeMirror) is a possible later step.

## R2 — Where document settings live

- **Decision**: One marked block right after `\documentclass`, plus the class size option, plus an optional engine marker on line 1 (format in [contracts/settings-block.md](contracts/settings-block.md)). The block is parsed and rewritten by pure functions in `src/latex/settings.ts`.
- **Rationale**: The settings travel with the `.tex` file and work in any LaTeX editor. Lexy only touches lines it owns (FR-018). Parsing a block Lexy wrote is reliable; parsing arbitrary preambles is not.
- **Alternatives considered**:
  - A sidecar JSON file: lost on copy or email, and Overleaf etc. ignore it.
  - Editing the user's own `\usepackage` lines: fragile and violates FR-018.
- **Conflict handling**: if a `geometry` or font package appears outside the block, show a one-time warning and still write the block. LaTeX reports the clash in the log.

## R3 — Fonts

- **Decision**: A built-in table that works with pdfLaTeX, plus installed Windows families via XeLaTeX + `fontspec`.

| id | Label | pdfLaTeX preamble |
| --- | --- | --- |
| `latin-modern` (default) | Latin Modern | `\usepackage{lmodern}` `\usepackage[T1]{fontenc}` |
| `times` | Times | `\usepackage{newtxtext,newtxmath}` |
| `palatino` | Palatino | `\usepackage{newpxtext,newpxmath}` |
| `helvetica` | Helvetica (sans) | `\usepackage[scaled]{helvet}` `\renewcommand{\familydefault}{\sfdefault}` `\usepackage[T1]{fontenc}` |
| `charter` | Charter | `\usepackage{XCharter}` |
| `libertine` | Linux Libertine | `\usepackage{libertine}` `\usepackage[libertine]{newtxmath}` |

  The system-font block is `\usepackage{fontspec}` + `\setmainfont{<Family>}`, with marker line `% !TEX program = xelatex`.
- **Listing fonts**: the `fontdb` crate (`Database::load_system_fonts()`, then each face's `families`) gives sorted, unique family names. It runs once and is cached in managed state. `fontdb` was not in Context7, so its API must be confirmed at implementation.
- **Validation**: family names must match `^[A-Za-z0-9 _.'&+-]{1,64}$`; anything else is dropped from the list and refused by the serializer (FR-020). This blocks `{ } \ % #` injection.
- **Rationale**: pdfLaTeX packages render fastest and need no engine switch. XeLaTeX is the standard route to system fonts.
- **Alternatives considered**: always using XeLaTeX (slower compiles and different behaviour for existing docs); LuaLaTeX (slower first run, much heavier font cache).

## R4 — Engine selection

- **Decision**: Rust reads the first 5 lines of the snapshot for `% !TEX program = <xelatex|lualatex|pdflatex>` (also `TS-program`), case-insensitively. It then passes `-xelatex` / `-lualatex` / `-pdf` to latexmk. Unknown values fall back to `-pdf`.
- **Rationale**: This is the TeXworks/TeXShop/VS Code convention, so the document stays the single source of truth, with no extra command parameter that could drift.
- **Alternatives considered**: a frontend-passed engine parameter (two sources of truth).

## R5 — Live preview pipeline

- **Decision**:
  1. **Scheduler**: `livePreview.ts`, a pure state machine with injected timers. Each edit (re)starts a 1000 ms debounce. When it fires, the latest text compiles if idle; if a compile is running, it marks `queued`. When a compile finishes and something is queued, it compiles the newest text. This gives at most one running plus one queued (FR-006).
  2. **Backend**: `compile_source(source, documentPath?)` writes the snapshot to `<build>/<key>/<stem>.tex` (key = hash of the document path, or `untitled`). It runs latexmk with `cwd` = the build folder. It sets `TEXINPUTS=<document folder>;` (a trailing `;` keeps the default search path) so `\input`/`\includegraphics` next to a saved document resolve (FR-007).
  3. **One compile at a time**: a `Mutex<()>` in Tauri managed state, which guards against two windows or an explicit and a live compile racing.
  4. **Explicit Compile/F5**: save, then `compile_source` with the saved text and path. It opens the log on failure (FR-009).
  5. **Live failures**: update the status line only and keep the last PDF.
- **Rationale**: One backend path for both kinds of compile, and the user's file is never written implicitly (PLAN P5).
- **Risk to verify in the quickstart**: that MiKTeX honours `TEXINPUTS` with the trailing-separator convention. Fallback: pass `-cd-` off and add `\makeatletter\def\input@path{{<docdir>/}}` via latexmk `-usepretex`.
- **Alternatives considered**:
  - Auto-saving the user's file before each live compile: a hidden write, which violates P5.
  - Compiling in the document's folder: litters it with aux files and races with the user's own tools.

## R6 — PDF rendering

- **Decision**: `pdfjs-dist` renders all pages into canvases inside a hidden container. Once every page is drawn, that container replaces the visible one and the previous `scrollTop` ratio is restored (FR-008). The worker is loaded via Vite's `?url` import (`GlobalWorkerOptions.workerSrc = workerUrl`). The previous document proxy is destroyed after the swap. Render scale = container width / page width × `devicePixelRatio`.
- **Shortcut**: render all pages eagerly. That's fine for ~30 pages; switch to IntersectionObserver lazy rendering when long documents matter.
- **Rationale**: Full control over refresh and scroll; same look in light and dark mode (pages stay white on a themed background).
- **Alternatives considered**: keeping the iframe and setting `#page=N` (no API to read the current page, and it still flashes); the built-in WebView2 viewer through the asset protocol (same problems).

## R7 — Equation editor

- **Decision**: A modal dialog containing:
  - a palette grouped as Structures (fraction, √, ⁿ√, xⁿ, xₙ, ∑, ∏, ∫, lim, 2×2 and 3×3 matrix), Greek (α–ω, Γ–Ω), Relations (≤ ≥ ≠ ≈ ≡ ∈ ⊂), Operators (± × ÷ · ∞ ∂ ∇) and Arrows (→ ⇒ ⇔ ↦);
  - a small CodeMirror field (one line, wraps);
  - a KaTeX preview (`katex.render(tex, el, { throwOnError: true, displayMode })`), with errors shown as text;
  - an Inline/Display radio.

  Palette snippets use `□` placeholders. Inserting selects the first `□`, and Tab jumps to the next.
- **Editing an existing equation**: a pure function `findEquationAt(doc, pos)` recognises `\( … \)`, `\[ … \]`, `$ … $` and `\begin{equation|equation*|align|align*} … \end{…}` around the cursor. The dialog loads that equation and replaces its range on insert.
- **Rationale**: KaTeX is synchronous and fast, which keeps the preview instant. Its coverage is a subset of LaTeX math, so a failed preview never blocks insertion.
- **Alternatives considered**: MathJax (bigger, asynchronous); MathLive WYSIWYG math field (large, opinionated keyboard; could come later).

## R8 — Tables

- **Decision**: `tables.ts` turns `{ rows, cols, header, borders, align, caption }` into LaTeX:
  - Borders on: `tabular` with `|c|c|` and a `\hline` around every row.
  - Borders off with a header row: a single `\hline` under the header.
  - With a caption: wrapped in `table[h]` + `\centering` + `\caption{}`.
  - Cells are `□` placeholders.
  - The hover grid is 10×8 (Word's size); the dialog allows rows 1–50 and cols 1–20.
- **Rationale**: Needs no extra packages, so no package management in the settings block.
- **Alternatives considered**: `booktabs` (nicer rules but needs a preamble package, so revisit with a package manager); `tabularx` (needs a width model).

## R9 — Ribbon structure and responsiveness

- **Decision**: WAI-ARIA tabs (`role="tablist"`, arrow keys move between tabs, Home/End jump), with groups as `role="group"` with a label. Labels show under icons when the ribbon is ≥ 900 px wide (CSS container query). Below that, buttons are icon-only with tooltips, and the group labels hide at < 820 px. The active tab is remembered. Format shortcuts Ctrl+B/I/U join the capture-phase handler. Ctrl+I overrides CodeMirror's `selectParentSyntax`, recorded as a decision like Ctrl+L.
- **Rationale**: Familiar to Word users, keyboard-accessible, and fits 800x600 (FR-010, FR-016).
- **Alternatives considered**: a menu bar (less discoverable); always-visible labels (overflows at 800 px).

## R10 — Default folder

- **Decision**: Rust command `default_document_folder()`:
  1. `app.path().document_dir()` resolves to `{FOLDERID_Documents}` (confirmed in Tauri docs), which follows OneDrive redirection.
  2. `create_dir_all(<docs>/Lexy)`.
  3. On error, fall back to `home_dir()` and set `fallback: true`.

  The frontend calls it before Save/Save as for untitled documents and before Open, and passes the folder or `<folder>\Untitled.tex` as the dialog's `defaultPath`.
- **Rationale**: Folder creation needs filesystem access, which stays in Rust (no fs plugin or scope).
- **Alternatives considered**: JS `documentDir()` (can't create the folder without the fs plugin).

## R11 — Version alignment

- **Decision**: `cargo update -p tauri -p tauri-plugin-dialog` to the 2.12 / 2.8 minors that match the npm packages; pin the npm side with `~` if the minors drift again.
- **Rationale**: Removes the "mismatched Tauri packages" error the CLI printed at launch.
