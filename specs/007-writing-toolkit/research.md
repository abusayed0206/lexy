# Research: Writing Toolkit

Decisions for `plan.md`. Library facts were checked with Context7 (`/codemirror/autocomplete`, `/websites/codemirror_net`) on 2026-11-14; re-check versions with Context7 when each batch starts. Windows UI rules come from the Microsoft pages listed in R15.

## R1. One source of project text: `project_texts` + TypeScript parsers

- **Decision**: Rust command `project_texts { paths? }` returns the text of every project text file (`.tex .bib .sty .cls .bst .txt .md`, ≤ 2 MiB each, hidden/build folders skipped, ≤ 2,000 files). The Writer caches the result, refreshes only the paths named by `project-changed`, and overlays unsaved buffers. All LaTeX understanding (index, outline, labels, bib keys, macros, search, word count) runs in pure TS in `src/latex/`.
- **Rationale**: one parser in one language, unit-tested with Vitest; JS `RegExp` semantics match between search and replace in open editors; Rust keeps sole filesystem access. 500 files × ~20 KB is ~10 MB once, then incremental.
- **Alternatives**: Rust-side index (two parsers to keep in sync, regex crate semantics differ from the editor's); reading files one by one with `read_file` (500 IPC round trips).

## R2. Suggestions

- **Decision**: `@codemirror/autocomplete` (already in `basicSetup`) with an `override` source from `src/latex/completions.ts`: after `\` + letters → built-in commands (`src/latex/commands.ts`, ~300 common commands/environments as `snippetCompletion` templates with `${}` placeholders) plus project macros (`\newcommand`, `\DeclareMathOperator`, `\def`); inside `\ref{ \eqref{ \autoref{ \cref{ \pageref{` → labels with context line; inside `\cite{ \citep{ \citet{ \parencite{ \textcite{ \autocite{` (comma-aware) → bib keys with title/author/year. `validFor` keeps filtering local (SC-001).
- **Alternatives**: a LaTeX language server (texlab): extra binary and process for what the index already gives.

## R3. `\begin`/`\end` auto-close and name sync

- **Decision**: `src/latex/environments.ts`: (a) an Enter handler when the cursor is right after `\begin{name}` (optionally `[…]`/`{…}` args) with no matching `\end{name}` below → insert `\n\t|\n\end{name}`; (b) a completion apply for `\begin{` suggestions inserting the pair; (c) a transaction extender that, when the name inside a `\begin{…}` changes, rewrites the matching `\end{…}` in the same transaction (matching by nesting depth). One undo step each.

## R4. Spell check

- **Decision**: Rust `spellbook` crate (Hunspell-compatible, pure Rust) with the `en_US` Hunspell dictionary from the `wooorm/dictionaries` package (`dictionary-en`, MIT/BSD; licence text bundled) as Tauri resources; more languages = drop-in `.aff/.dic` pairs under `%LOCALAPPDATA%\Lexy\Dictionaries`. TS extracts words from readable ranges of the visible viewport (`readable.ts`), batches unique words to `spell_check`, and shows results as `@codemirror/lint` diagnostics with source `spell` (separate from compile problems). Words in scripts the dictionary doesn't cover (e.g. Bangla) are never sent. Personal dictionary: `%LOCALAPPDATA%\Lexy\dictionary.txt` (one word per line).
- **Rationale**: offline, no account (spec assumption), fast, licence-compatible with GPL-3.0.
- **Alternatives**: WebView2 native spellcheck (marks commands; can't be scoped to readable text); `nspell` in JS (slow on large dictionaries, blocks the UI thread).
- **Verify at batch start**: current `spellbook` version and its `suggest` API via Context7/crates.io.

## R5. Grammar check (opt-in)

- **Decision**: LanguageTool HTTP API `POST /v2/check` with the `data` parameter (annotated text: markup parts marked `markup`, readable parts `text`, built by `readable.ts`) so offsets map back and LaTeX is ignored. Default server `https://api.languagetool.org`, configurable to a self-hosted URL. Off until the user turns it on in Settings; the first run shows "Checked text is sent to <server>" with Turn on / Cancel. Runs on demand (F7 / Review → Check grammar) for the current file, ≤ 20 KB per request (free API limit), via Rust `ureq` with a 15 s timeout.
- **Alternatives**: bundling LanguageTool (Java, ~200 MB).

## R6. Word count

- **Decision**: `wordCount.ts` counts words in readable ranges (Unicode-aware via `Intl.Segmenter` word granularity, so Bangla counts correctly) over the main document and everything it `\input`s/`\include`s (from the index), with unsaved buffers; selection count from the editor selection. Shown in the status bar: "1,234 words" / "56 of 1,234 words".

## R7. Hover math

- **Decision**: `hoverTooltip` in `Editor.tsx` that finds the math span under the pointer (`$…$`, `\(…\)`, `\[…\]`, `equation`/`align`/… environments) via `readable.ts` math ranges and renders it with KaTeX (already used by the equation dialog), `hoverTime: 300`. KaTeX errors show the message text.

## R8. Tidy

- **Decision**: `tidy.ts` pure function: re-indent by environment depth (tab = 2 spaces, matching the editor), leaving `verbatim`, `lstlisting`, `minted`, `comment` and `\begin{document}` level untouched, trimming trailing spaces. Applied with `EditorHandle.replaceAll` (one undo step). Shortcut Shift+Alt+F (VS Code precedent).

## R9. Outline

- **Decision**: `index.ts` produces outline entries (part … subparagraph, figure/table with caption, starred variants) following `\input`/`\include`/`\subfile` from the main document in order. `Outline.tsx` is a tree in a new sidebar tab (Files | Outline | Notes), using the Sidebar's existing tree keyboard pattern; clicking opens the file and calls `jumpToLine`. Refresh debounced 500 ms after edits (< 2 s target).

## R10. Editor tabs

- **Decision**: `EditorTabs.tsx` above the editor, driven by a `tabs: string[]` order added to the `openFiles.ts` reducer (`open` appends, `close` removes, `reorder`). Follows Windows TabView rules (R15): one tab always active; closing the active tab selects the next; Ctrl+Tab / Ctrl+Shift+Tab cycle; Ctrl+W and Ctrl+F4 close (unsaved → the existing Save / Don't save / Cancel choice); drag to reorder plus Ctrl+Shift+PageUp/PageDown; Left/Right move focus within the strip; overflow scrolls with arrow bumpers; middle-click closes; context menu: Close, Close others, Copy path, Reveal in sidebar.

## R11. Folding

- **Decision**: `folding.ts` exports a `foldService` (the legacy `stex` mode has no syntax tree): a `\part … \subparagraph` line folds to the line before the next heading of the same or higher level (or `\end{document}`); a `\begin{x}` line folds to its matching `\end{x}`. `foldGutter` and `foldKeymap` (Ctrl+Shift+[ / ]) come from `basicSetup`.

## R12. Action registry and command palette

- **Decision**: `src/actions.ts` defines `Action { id, title, group, shortcut?, run, enabled? }`. The Writer builds the list once from its existing handlers; the Ribbon and the shortcut listener read titles/shortcuts from it (one source for tooltips, palette and shortcuts). `CommandPalette.tsx` (Ctrl+Shift+P) filters by fuzzy match (subsequence, ranked by start-of-word hits), shows the shortcut, Enter runs, Esc closes. Every new action in this feature is registered (FR-023).

## R13. Project find and replace

- **Decision**: `search.ts` runs over cached `project_texts` + buffers with JS `RegExp` (escaped unless "Regular expression"; `\b` for whole word; `i` unless match case), max 5,000 hits, grouped by file with line previews. **Replace all applies to editor buffers, never directly to disk**: each affected file is opened (if not already) and replaced with one `replaceAll` transaction (one undo step, marked unsaved); the user saves with Ctrl+S. Read-only windows can search but not replace.
- **Rationale**: no silent disk writes, undo per file, unsaved buffers handled by construction (spec acceptance 2.5, SC-008).

## R14. Focus mode and Vim

- **Decision**: focus mode (F11, View → Focus) hides ribbon, sidebar, tabs and drawer; a second F11 or Esc restores (Esc only when no transient UI is open). PDF stays unless "Hide PDF in focus mode" is on. Vim: `@replit/codemirror-vim` loaded in a `Compartment`, off by default, toggled from Settings; status bar shows "-- INSERT --"/"NORMAL"/"VISUAL" from the package's mode events. When Vim is on, Lexy's capture-phase shortcuts still win (documented).

## R15. Windows design alignment (user request)

Sources: guidelines overview, typography, color, iconography, commanding basics, dialogs, InfoBar, TabView, tooltips, keyboard interactions, access keys, accessibility overview, app settings (all under https://learn.microsoft.com/en-us/windows/apps/design/), read 2026-11-14.

Rules adopted into `docs/DESIGN.md` → "Windows design alignment":

1. **Type ramp** (Segoe UI Variable): caption 12/16, body 14/20, body strong 14/20 semibold, subtitle 20/28 semibold, title 28/36 semibold. UI body goes from 15 px to 14 px; nothing below 12 px regular. Emphasis = semibold, not bold/italic. Sentence case for all UI text.
2. **Dialogs**: question in the first line; specific verbs ("Delete", "Save all"), never "OK" for a question; button order primary (accent, Enter) left → secondary → safe close (Esc) right; initial focus never on a destructive button; one dialog at a time. Errors tied to one place are inline, not dialogs.
3. **Dialog vs InfoBar vs flyout**: dialog only to confirm irreversible actions (overwrite, close without saving, permanent delete) or a blocking state; **InfoBar** (inline, severity default/success/warning/error, icon + text, closable) for app-state changes (folder missing, stale preview, offline, Bangla font offer); flyout/menu for contextual, light-dismiss content. Reversible actions (Recycle Bin delete, rename, replace in buffers) get no confirmation.
4. **Keyboard**: Tab order follows visual order; arrows move inside groups (ribbon, trees, tab strip); Esc cancels transient UI only; **F6 / Shift+F6 cycle panes** (ribbon → sidebar → tabs/editor → PDF → drawer); Ctrl+letter accelerators shown in tooltips; Alt shows access-key tips on ribbon tabs (F File, H Home, N Insert, P Layout, W View, G Git; Word precedents) — P3 within batch W.
5. **Tabs**: as R10.
6. **Tooltips**: only for icon-only controls or supplemental info; include the shortcut; never errors or status (those go in the drawer/InfoBar); no interactive content.
7. **Color and contrast**: accent used sparingly for state/emphasis; never color alone (icons + text for severity); text contrast ≥ 4.5:1 (large text ≥ 3:1) in light and dark — enforced by a Vitest that computes contrast for the token pairs in `App.css`; `@media (forced-colors: active)` keeps borders, focus rings and selection visible with system colors.
8. **Settings page**: one scrollable column (max ~1000 px), section headers in body strong, toggles for on/off, radio buttons for ≤ 5 options, a combo box for theme ("Use system setting", "Light", "Dark"), changes apply immediately (no Save button), About at the bottom; reached from File → Settings (Ctrl+,).
9. **Icons**: keep the current monoline set at 16 px; match Segoe Fluent Icons metaphors where one exists.

## R16. Content, review, safety and export

- **DOI**: `fetch_doi` requests `https://doi.org/<doi>` with `Accept: application/x-bibtex` (doi.org content negotiation), 10 s timeout, ≤ 64 KB; only the DOI is sent (FR-024). TS normalizes the key (`authorYearWord`, unique against the index) and appends to the chosen `.bib` via `write_file`.
- **Images**: reuse `import_files` (copy into `figures/` by default, "Keep both" naming so nothing is overwritten), then `figure.ts` inserts the figure block at the drop position and adds `\usepackage{graphicx}` after the class line if missing (one undo step; respects the settings-block rule: Lexy adds a single package line only, never edits other preamble lines).
- **Templates**: five single-file `.tex` templates in `src/templates/` (imported with Vite `?raw`) passed as `starter` to the existing `create_project { name, starter }`, so no new command. A Rust real e2e compiles each via `include_str!("../../src/templates/<id>.tex")` (SC-006).
- **Notes**: `.lexy/notes.json` (see data-model). Anchors are (file, from, to, quote); open editors map positions through changes (`RangeSet` decorations); on load, if the quote is no longer at the offset, search for it nearby, else mark **detached**. Notes PDF: `notes.ts` injects `\todo{…}` (package `todonotes`, MiKTeX installs on demand) into copies of the buffers, compiled by `export_pdf_with_notes` into `<name> (notes).pdf`; the normal PDF never has notes.
- **Compare**: Git projects use `git_show_file` at a commit (or the last commit before a date via `git_log`); others use snapshots. `wordDiff.ts` (Myers diff over word tokens) renders insertions/deletions in a read-only `CompareView`.
- **Duplicate / copy / paste**: `copy_entry { from, toDir }` copies a file or folder inside the project, naming `name (copy).ext`, then `(copy 2)`; never overwrites.
- **Auto-save**: off by default; 5 s after the last edit, `Save all` for modified files; never in read-only windows.
- **Snapshots**: inside `write_file`, when the project has no Git repo, store the previous text in `%LOCALAPPDATA%\Lexy\Snapshots\<hash(root)>\<rel>\<unix-ms>.txt` if the newest snapshot is ≥ 10 min old; prune > 30 days on project open. Restore = load into the editor as an unsaved change.
- **Export**: Pandoc (pinned version, Windows x86_64 ZIP from the official GitHub release, SHA-256 pinned at implementation time) installed into `%LOCALAPPDATA%\Lexy\Tools\Pandoc` after a consent dialog with the size; progress through the same `Reporter` pattern as `setup.rs`. `export_document { format }` runs `pandoc <main>.tex --from latex --to docx|html5 --resource-path <project> [--citeproc] [--mathml for HTML]` writing beside the main document; stderr warnings become the "approximated" report.
