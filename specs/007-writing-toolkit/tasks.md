---
description: "Task list for 007: writing toolkit + Windows design alignment"
---

# Tasks: Writing Toolkit

**Input**: `specs/007-writing-toolkit/`: plan.md, spec.md (US1–US7, FR-001…FR-024, SC-001…SC-008), research.md (R1–R16), data-model.md, contracts/commands.md, contracts/ui.md, quickstart.md

**Working rule (user request, as in 003–006)**: build similar features together and run the tests once per batch, at its gate. Tests are written inside the batch. Don't start the next batch with a failing gate. Update `docs/TRACKER.md` (rows F-066…F-073) at every gate.

**Reuse, don't re-create**: `resolve_in_project`, `write_atomic`, `import_files_at`, `create_folder`, `is_editable`, `blocking`, `display_path` (`src-tauri/src/project.rs`); `run_with_timeout`, `hide_console`, `compile_project_at` (`src-tauri/src/lib.rs`); download/verify/unzip helpers and `Reporter` (`src-tauri/src/setup.rs`); `git_show_file`, `git_log` (`src-tauri/src/git.rs`); `EditorHandle.apply/applyTo/replaceAll/jumpToLine/setProblems`, kept per-file `EditorState` (`src/Editor.tsx`); `applyFiles` + `openFiles.ts` reducer, `onEntryOpen`, `setInfo`, the capture-phase shortcut listener (`src/Writer.tsx`); `useChoice`, `useNamePrompt` (`src/ProjectDialogs.tsx`); `RibbonButton`, `MenuButton`, `Icon` (`src/Ribbon.tsx`, `src/ribbon/`); `src/git/diff.ts`; KaTeX setup from `src/ribbon/EquationDialog.tsx`; theme variables in `src/App.css`.

**Copy rule**: sentence case, short operational text, exact strings from `contracts/ui.md`.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 (done: `@replit/codemirror-vim` ^6.4.0, `@codemirror/autocomplete` ^6.20.4) Add `"@replit/codemirror-vim"` and an explicit `"@codemirror/autocomplete"` (version already in `node_modules/@codemirror/autocomplete/package.json`) to `package.json` dependencies; check the current vim package version with Context7 first; run `npm install`
- [X] T002 [P] (done: `spellbook` 0.4.2, MPL-2.0; API `Dictionary::new(aff, dic)`, `check`, `suggest(word, &mut Vec)`, `add(word)`) Add the `spellbook` crate to `src-tauri/Cargo.toml` (check the current version and its check/suggest API with Context7 or crates.io first) and run `cargo check`
- [X] T003 [P] (done: `dictionary-en` 4.0.0, SCOWL 2020.12.07; a Rust test checks it parses) Add the `en_US` Hunspell dictionary (`en_US.aff`, `en_US.dic` from the `dictionary-en` package of wooorm/dictionaries) plus its licence as `src-tauri/resources/dictionaries/en_US.{aff,dic,LICENSE}` and list `resources/dictionaries/*` under `bundle.resources` in `src-tauri/tauri.conf.json`
- [X] T004 [P] Create empty modules `src-tauri/src/{spell,web,snapshots,settings,export}.rs` with `mod` lines in `src-tauri/src/lib.rs`

**Checkpoint**: `cargo check` and `npx tsc --noEmit` pass.

---

## Phase 2: Foundational (Batch 0, blocks every story)

- [X] T005 (done: paths use `\` like `Entry`; symlinks/junctions are not followed) In `src-tauri/src/project.rs` add `project_texts_at(root, paths: Option<&[String]>) -> Result<ProjectTexts>` and command `project_texts { paths? }` per contracts/commands.md ("`.tex .bib .sty .cls .bst .txt .md`, ≤ 2 MiB, UTF-8 only, ≤ 2,000 files, `truncated` flag"; reuse the watcher's ignore filter for dot-folders and build clutter); register it in `src-tauri/src/lib.rs`
- [X] T006 [P] (done) In `src/projects.ts` add `ProjectText { path, text, modified }` and `projectTexts(paths?)`
- [X] T007 (done) In `src-tauri/src/settings.rs` implement `Settings` (fields and defaults exactly as in data-model.md "Settings"), `load`/`save` (atomic, unknown keys kept, invalid values → defaults), commands `get_settings` / `set_settings`; register in `lib.rs`
- [X] T008 [P] (done: provider wraps `<App />` in `src/main.tsx`, so App tests are unchanged; components outside it get the defaults) Create `src/settings.ts`: `Settings` type mirroring Rust, `getSettings`/`setSettings`, a `SettingsContext` + `useSettings()` hook that reloads on window focus (US6.2); provide it in `src/App.tsx`
- [X] T009 [P] (done: also `mathAt` and `proseOnly`) Create `src/latex/readable.ts`: `readableRanges(text) -> { text: Range[], math: Range[], markup: Range[] }` (skip command names, their key/label/ref/cite/url/includegraphics arguments, comments, `verbatim`-like environments; math = `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, math environments) and `annotate(text) -> AnnotatedPart[]` for LanguageTool
- [X] T010 (done: `buildIndex(texts, main, cache)` reparses only files whose text changed; `documentFiles` replaces `wordCount`, which US1 T020 computes) Create `src/latex/index.ts`: `buildIndex(texts: Map<path, text>, main) -> ProjectIndex` per data-model.md (macros, labels with context and duplicate flag, bib entries, outline following `\input`/`\include`/`\subfile` from `main` in order, word count) and `updateIndex(prev, changedPaths)` that reparses only changed files
- [X] T011 [P] (done: plus `searchActions` and `ribbonCommands(RibbonActions)`, which lists the existing ribbon commands) Create `src/actions.ts`: `Action { id, title, group, shortcut?, run, enabled? }` and `fuzzyMatch(query, title) -> score | null` (subsequence, start-of-word bonus)
- [X] T012 (done for texts + index: `projectIndex` ref refreshed 500 ms after edits, texts reloaded on every tree change (marked shortcut). Changed: the action list is the pure `ribbonCommands`; the Writer builds it, and the ribbon reads titles from it, in T036, where the palette first uses it) In `src/Writer.tsx` keep a `texts` cache (load `projectTexts()` on open, refresh changed paths from `project-changed`, overlay unsaved buffers) and a debounced (500 ms) `ProjectIndex` in state; build the `actions` list from the existing handlers (File, Home, Insert, Layout, View, Git) and pass titles/shortcuts to `Ribbon.tsx` from it
- [X] T013 [P] (done: new icons info/success/warning/error/close) Create `src/InfoBar.tsx` (`severity: "default" | "success" | "warning" | "error"`, icon + text, optional actions, optional close button, `role="status"` or `role="alert"` for error) and its styles in `src/App.css`
- [X] T014 [P] (done: Rust 7 new tests; Vitest readable 11, index 9, actions 5, InfoBar 2, settings 3) Tests: Rust `project_texts` (filters, size cap, non-UTF-8 skipped, `paths` subset, junction outside refused) and `settings` (defaults, invalid values, unknown keys kept) in their modules; Vitest `src/latex/readable.test.ts`, `src/latex/index.test.ts` (nested includes, starred sections, captions, duplicate labels, bib parsing with braces and quotes), `src/actions.test.ts`, `src/InfoBar.test.tsx`
- [X] T015 (passed 2026-11-14: 140 Rust, 394 Vitest, tsc, build) **Gate 0**: `cd src-tauri; cargo test` and `npm test` once; fix failures

---

## Phase 3: US1 Writing aids (P1) — Batch A 🎯 MVP

**Goal**: suggestions, `\end` auto-close, spell and grammar check, word count, hover math, tidy.
**Independent test**: quickstart A.

- [X] T016 [P] [US1] (done: ~230 commands and 45 environments) Create `src/latex/commands.ts`: ~300 built-in commands and environments as `{ label, template, detail }` (sectioning, text formatting, math, references, floats, lists, tables, common package commands)
- [X] T017 [US1] (done) Create `src/latex/completions.ts`: `latexCompletions(getIndex) -> CompletionSource` per research R2 (command context after `\`, label context inside `\ref`-family braces, citation context inside `\cite`-family braces, comma-aware; `snippetCompletion` for templates; `validFor` regexes)
- [X] T018 [US1] (done: `latexEnvironments` = Enter keymap + transaction filter; `\begin` completion swallows the `}` closeBrackets adds) Create `src/latex/environments.ts` per R3: Enter handler after `\begin{name}`, `\begin{` completion apply inserting the pair, and a transaction extender keeping `\end{…}` in sync with an edited `\begin{…}` name (nesting-aware), each one undo step
- [X] T019 [P] [US1] (done) Create `src/latex/tidy.ts` per R8 (2-space indent by environment depth; `verbatim`, `lstlisting`, `minted`, `comment` untouched; trailing spaces trimmed)
- [X] T020 [P] [US1] (done: `countWords`, `projectWordCount` with a per-file cache) Create `src/latex/wordCount.ts`: `countWords(text)` over readable ranges with `Intl.Segmenter` word granularity, `projectWordCount(index, buffers)`
- [X] T021 [US1] (done: dictionaries from `%LOCALAPPDATA%\Lexy\Dictionaries`, the bundled resources, and in debug builds the source folder) In `src-tauri/src/spell.rs` implement `SpellState` (dictionaries loaded lazily from resources and `%LOCALAPPDATA%\Lexy\Dictionaries`, personal words from `%LOCALAPPDATA%\Lexy\dictionary.txt`) and commands `spell_check`, `spell_suggest`, `dictionary_add` per contracts/commands.md; register state and commands in `lib.rs`
- [X] T022 [US1] (done: `grammar_request` testable over http; the command requires https and grammar turned on) In `src-tauri/src/web.rs` add a capped HTTP helper (timeout, max bytes, https only, Windows root store as in `kriti.rs`) and `grammar_check` per contracts/commands.md (refuse when `grammarCheck` is off)
- [X] T023 [P] [US1] (done) Create `src/writingAids.ts` wrappers (`spellCheck`, `spellSuggest`, `dictionaryAdd`, `grammarCheck`, later `fetchDoi`) and types `GrammarIssue`, `AnnotatedPart`
- [X] T024 [US1] (done in `src/editorAids.ts` + `Editor.tsx`: spelling and grammar are their own decoration layers, not lint diagnostics, so they never replace compile problems; editor tooltips themed for dark mode) In `src/Editor.tsx` add extensions: `autocompletion({ override: [latexCompletions(...)] })`, the environments extension, `hoverTooltip` math preview with KaTeX (`hoverTime: 300`, error text on failure), and a spell linter (visible viewport → readable words → `spellCheck` batch, cached per word; skip words without Latin letters; separate diagnostic source `spell`, dotted underline); add `EditorHandle.tidy()` and `EditorHandle.selectionText()`
- [X] T025 [US1] (done: fixed-position menu, arrow keys, Esc) Spelling context menu in `src/Editor.tsx`: right-click on a marked word → up to 8 suggestions, "Add to dictionary", "Ignore" (session only); Enter/arrow keys work in the menu
- [X] T026 [US1] (done: word count beside the status; Tidy + Check grammar in a Home "Proofing" group (Review tab comes with US4); consent dialog follows the current Cancel-left order until batch W) In `src/Writer.tsx` + `src/Ribbon.tsx`: status bar word count ("1,234 words" / "56 of 1,234 words"); actions `edit.tidy` (Shift+Alt+F, Home tab) and `review.grammar` (F7) — first use with grammar off shows the consent choice naming the server (Turn on / Cancel) and turns `grammarCheck` on; grammar issues shown as accent wavy diagnostics with replacement buttons in the hover
- [X] T027 [P] [US1] (done) Vitest: `src/latex/completions.test.ts` (contexts, comma lists, macros, labels with context), `environments.test.ts` (Enter insert, rename sync, nested, undo step), `tidy.test.ts`, `wordCount.test.ts` (commands/math excluded, Bangla words counted), spell-linter readable filtering in `src/Editor.test.tsx`; Writer tests for the word count and grammar consent
- [X] T028 [P] [US1] (done) Rust tests: `spell.rs` (known/unknown words, personal dictionary add + reload, unknown language error), `web.rs` `grammar_check` against a local HTTP server (`setup.rs` test pattern: success, off refusal, timeout, oversize body)
- [X] T029 [US1] (passed 2026-11-14: 146 Rust, 429 Vitest, tsc, build; browser pane with a stub backend at 800x600 dark: spelling marks on prose only, label/citation/command suggestions, \begin auto-close, spelling menu replace, KaTeX hover. Native quickstart A walk pending) **Gate A**: `cd src-tauri; cargo test spell web` and `npm test` once; fix failures; walk quickstart A; update TRACKER F-066 + Verification Log

---

## Phase 4: US2 Navigation and layout (P1) — Batch B

**Goal**: outline, tabs, folding, palette, project find/replace, focus mode, Vim.
**Independent test**: quickstart B.

- [X] T030 [P] [US2] (done: document text cached per version, lines without `\` skipped) Create `src/latex/folding.ts`: `latexFoldService` per R11 (headings to the next same/higher level or `\end{document}`; `\begin{x}` to its matching `\end{x}`)
- [X] T031 [P] [US2] (done) Create `src/latex/search.ts`: `searchProject(texts, buffers, query, { matchCase, wholeWord, regex }) -> { file, hits: { line, from, to, preview }[] }[]` (max 5,000 hits; invalid regex → typed error) and `replaceIn(text, query, options, replacement) -> { text, count }`
- [X] T032 [US2] (done: Map order is the tab order; `reordered`, closing shows the right/left neighbour, `opened` with `background`) In `src/openFiles.ts` add tab order (`tabs: string[]`; `open` appends, `close` removes and selects the next, `reorder { path, index }`) and update `src/openFiles.test.ts`
- [X] T033 [US2] (done: overflow scrolls with a thin scrollbar instead of ‹ › buttons; the main document's tab has no close button) Create `src/EditorTabs.tsx` per contracts/ui.md and R10 (tablist keyboard pattern, close buttons, overflow ‹ › scroll, drag reorder, middle-click close, context menu Close / Close others / Copy path / Reveal in sidebar) and render it above the editor in `src/Writer.tsx`; shortcuts Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+W, Ctrl+F4, Ctrl+Shift+PageUp/PageDown in the capture-phase listener
- [X] T034 [US2] (done: side panel tabs Files | Outline | Search in `Writer.tsx`; Notes tab comes with US4; Find in project is the Search tab rather than replacing the tree) Create `src/Outline.tsx` (tree from `ProjectIndex.outline`, icons per kind, ellipsis + full title, Enter/click → open file + `jumpToLine`, "No headings yet") and turn `src/Sidebar.tsx`'s header into tabs Files | Outline | Notes (Notes is a placeholder until US4); Ctrl+Shift+O opens Outline
- [X] T035 [US2] (done) Add `latexFoldService` (plus the existing fold gutter/keymap from `basicSetup`) to `src/Editor.tsx` extensions
- [X] T036 [US2] (done: the palette lists `ribbonCommands` plus tab, outline, search, Vim and spelling toggles; the ribbon still has its own labels, kept in step by `actions.test.ts`) Create `src/CommandPalette.tsx` per contracts/ui.md over the `actions` list (fuzzy match, shortcut column, ↑/↓, Enter, Esc, "No matching commands"); Ctrl+Shift+P in `src/Writer.tsx`
- [X] T037 [US2] (done: Replace all opens files in the background (`preload` keeps undo) and never writes to disk) Create `src/ProjectSearch.tsx` per contracts/ui.md (fields, Alt+C/W/R toggles, grouped results, open on Enter, inline regex error); Replace all per R13: open each affected file (if needed) and call `EditorHandle.applyTo(path, replaceAll…)` so each file is one undo step and unsaved; success InfoBar "Replaced N matches in M files. Press Ctrl+S to save."; replace disabled in read-only windows; Ctrl+Shift+F in `src/Writer.tsx`
- [X] T038 [US2] (done: F11 and View → Focus; no Esc exit, since Esc belongs to the editor (suggestions, Vim)) Focus mode in `src/Writer.tsx` (F11 / View → Focus; hides ribbon, tabs, sidebar, drawer, and PDF when `hidePdfInFocus`; F11 or Esc with no transient UI restores; "Leave focus mode (F11)" button near the top edge) with styles in `src/App.css`
- [X] T039 [US2] (done: uses the package's own mode line (`vim({ status: true })`) under the editor instead of the Lexy status bar; toggled from the palette until Settings exist) Vim in `src/Editor.tsx`: a `Compartment` holding `vim()` when `settings.vim` is on; report mode changes to the Writer status bar ("NORMAL", "-- INSERT --", "VISUAL")
- [X] T040 [P] [US2] (done) Vitest: `folding.test.ts`, `search.test.ts` (case, whole word, regex, invalid regex, unsaved buffer wins over disk text, cap), `EditorTabs.test.tsx` (keyboard, close selects next, reorder), `Outline.test.tsx`, `CommandPalette.test.tsx`, `ProjectSearch.test.tsx`; Writer tests: replace-all opens files as unsaved with one undo step each, focus mode toggle, Ctrl+W on unsaved asks
- [X] T041 [US2] (passed 2026-11-14: 470 Vitest, tsc, build; browser pane with a stub backend at 800x600: tabs, side panel, outline across `\input`, search, palette, focus mode; no horizontal overflow. Native quickstart B pending) **Gate B**: `npm test` and `npm run build` once; fix failures; walk quickstart B at 800x600 and full size, light and dark; update TRACKER F-067 + Verification Log

---

## Phase 5: US5 Files and safety (P2) — Batch C

**Goal**: duplicate/copy/paste, auto-save, snapshots. (Before US3/US4 so SC-008 "no lost text" is covered early.)
**Independent test**: quickstart C.

- [X] T042 [US5] (done: a copy into another folder keeps its name when free; links are skipped; not marked as Lexy's own write, so the watcher just refreshes the tree) In `src-tauri/src/project.rs` add `copy_entry_at(root, from, to_dir) -> Result<String>` and command `copy_entry` per contracts/commands.md ("`<stem> (copy)<ext>`, then `(copy 2)`; never overwrites; folder into itself refused; refuses read-only"); register in `lib.rs`; mark as Lexy's own write for the watcher
- [X] T043 [US5] (done: `snapshots.rs`; taken in the `write_file` command before overwriting, best effort; pruned in a background thread on `open_project`) In `src-tauri/src/snapshots.rs` implement `take(root_hash, rel, previous_text, now)` (only when the newest snapshot is ≥ 10 min old), `prune(older_than_days = 30)`, `list`, `read`; call `take` from `write_file_at` when the project has no `.git` (walk up like `git.rs` `--show-prefix` logic, cached per open project), `prune` on `open_project`; commands `list_snapshots`, `read_snapshot`
- [X] T044 [P] [US5] (done) In `src/projects.ts` add `copyEntry`, `listSnapshots`, `readSnapshot` and `Snapshot` type
- [X] T045 [US5] (done) In `src/Sidebar.tsx` context menu add Duplicate, Copy, Paste (Paste enabled only after Copy in this window; disabled read-only) wired through `src/Writer.tsx`
- [X] T046 [US5] (done; toggled from the palette until the Settings screen exists) Auto-save in `src/Writer.tsx`: when `settings.autoSave`, `autoSaveDelayMs` after the last edit run the existing Save all for modified files; never in read-only windows; no prompt, no drawer
- [X] T047 [US5] (done as File → Earlier versions ("History" is taken by the Git tab); Git projects go to Git → History; Compare comes with US4) File → History (projects without Git) in `src/Writer.tsx` + a small list dialog: snapshots of the current file with "Restore" (load into the editor as one unsaved, undoable change) and "Compare" (enabled after US4's CompareView; hidden until then)
- [X] T048 [P] [US5] (done: Rust 6 new, Vitest 6 new) Rust tests: `copy_entry` naming sequence, folder copy, into-itself refusal, read-only refusal; snapshots (10-min throttle with injected clock, 30-day prune, none in a Git project, stored outside the project); Vitest: Sidebar menu items, auto-save timing with fake timers (off by default, read-only never), restore is undoable
- [X] T049 [US5] (passed 2026-11-14: 152 Rust, 476 Vitest, tsc, build; browser pane with a stub backend at 800x600: File tab fits, Earlier versions lists snapshots and Restore puts the old text in the editor as an unsaved change. Native quickstart C pending) **Gate C**: `cd src-tauri; cargo test` and `npm test` once; fix failures; walk quickstart C; update TRACKER F-070 + Verification Log

---

## Phase 6: US3 Content (P2) — Batch D

**Goal**: citation picker, DOI, image insert/drop, templates.
**Independent test**: quickstart D.

- [X] T050 [P] [US3] (done: plus `rekey`, `firstEntry`, `appendEntry`; `insertCitation` adds keys to a `\cite{…}` the cursor is already in) Create `src/latex/citations.ts`: `parseBibEntry(bibtex)`, `uniqueKey(entry, existingKeys)` (`authorYearWord`, then `a`, `b`…), `citeCommand(keys)`, `bibliographySetup(mainText) -> TextEdit | null` (adds `\bibliographystyle{plain}` + `\bibliography{references}` before `\end{document}` when no bibliography command exists)
- [X] T051 [P] [US3] (done: `insertFigure` puts the figure on its own line and selects the caption) Create `src/latex/figure.ts`: `figureBlock(relPath) -> string` (figure, `\centering`, `\includegraphics[width=0.8\linewidth]{…}`, caption and label placeholders) and `ensureGraphicx(mainText) -> TextEdit | null` (one `\usepackage{graphicx}` line after the class line / settings block; never edits other preamble lines)
- [X] T052 [US3] (done: accepts bare DOIs, `doi:` and doi.org links; percent-encodes the path) In `src-tauri/src/web.rs` add `fetch_doi` per contracts/commands.md (DOI only, `Accept: application/x-bibtex`, 10 s, 64 KB, "Could not fetch this DOI"); register in `lib.rs`; wrapper `fetchDoi` in `src/writingAids.ts`
- [X] T053 [US3] (done: Insert → Citation in a References group; "Add and cite" appends to the chosen .bib as an unsaved edit and inserts the citation) Create `src/ribbon/CitationDialog.tsx` and `src/ribbon/DoiDialog.tsx` per contracts/ui.md; Insert → Citation in `src/Ribbon.tsx`; on add, append the entry to the chosen `.bib` through the editor (open file) or `write_file`, and when no `.bib` exists offer "Create references.bib" + `bibliographySetup`
- [X] T054 [US3] (done: Insert → Image in an Illustrations group; the Writer has its own drag-drop listener next to the sidebar's) Insert → Image (file picker via the dialog plugin) and editor drop (images only; others import like the sidebar) in `src/Writer.tsx`: `import_files` into `settings.imageFolder` with `keepBoth`, then `figureBlock` at the cursor/drop point and `ensureGraphicx` on the main document (each one undo step); InfoBar "Copied <name> to figures/"
- [X] T055 [P] [US3] (done: CV uses plain `article` with a small `\entry` macro, no extra fonts) Create `src/templates/{article,report,letter,cv,beamer}.tex` (each compiles with pdfLaTeX and the packages MiKTeX installs on demand, no Lexy settings block conflicts) and `src/templates/index.ts` listing `{ id, name, description, text }`
- [X] T056 [US3] (done: radio-group gallery in Project Home's form and a `NewProjectDialog` for File → New project) Create `src/TemplateGallery.tsx` and use it in the New project prompt (`src/ProjectHome.tsx` and File → New project in `src/Writer.tsx`): Blank (current `STARTER_DOCUMENT`) selected by default; the chosen text is the `starter` for `create_project`
- [X] T057 [P] [US3] (done: all five templates compiled for real on this machine) Rust tests: `fetch_doi` against a local server (success, 404, non-BibTeX, oversize); real e2e in `src-tauri/src/lib.rs` compiling every template via `include_str!("../../src/templates/<id>.tex")` (skips without MiKTeX; SC-006)
- [X] T058 [P] [US3] (done) Vitest: `citations.test.ts`, `figure.test.ts`, `CitationDialog.test.tsx`, `DoiDialog.test.tsx` (offline error adds nothing), `TemplateGallery.test.tsx`; Writer test: image drop inserts a figure and graphicx once
- [X] T059 [US3] (passed 2026-11-14: 155 Rust, 503 Vitest, build; browser pane with a stub backend at 800x600: Insert tab fits, citation dialog lists entries, New project gallery fits with Blank preselected. Native quickstart D (real DOI lookup, real drop) pending) **Gate D**: `cd src-tauri; cargo test` and `npm test` once; fix failures; walk quickstart D; update TRACKER F-068 + Verification Log

---

## Phase 7: US4 Review (P2) — Batch E

**Goal**: notes, notes PDF, compare.
**Independent test**: quickstart E.

- [X] T060 [P] [US4] (done: plus `parseNotes`/`serializeNotes`, `newNote`, `withTodonotes`; `ensurePackage` generalized from `ensureGraphicx`) Create `src/latex/notes.ts`: `NotesFile` type (data-model.md "Note": `id`, `file`, `from < to`, `quote` ≤ 200 chars, `body` 1–2,000 chars, `state` open/resolved/detached), `reanchor(note, text)` (offset, else nearest quote match, else `detached`), `injectTodos(text, notes) -> text` (`\todo{…}` at each open note's end, escaped) and `ensureTodonotes(mainText)`
- [X] T061 [P] [US4] (done: common start/end trimmed first; falls back to whole-text replace past 4,000 edits) Create `src/latex/wordDiff.ts`: Myers diff over word + whitespace tokens → `{ kind: "same" | "added" | "removed", text }[]`
- [X] T062 [US4] (done: `is_editable` allows only `.lexy\notes.json`; the notes PDF compiles under `<build root>\Notes`, so the preview's build folder and SyncTeX data are untouched) In `src-tauri/src/project.rs` let `is_editable` accept `.lexy/notes.json`; in `src-tauri/src/lib.rs` add `export_pdf_with_notes` per contracts/commands.md (own build key, never touches the shown preview, writes `<stem> (notes).pdf`)
- [X] T063 [US4] (done: highlights are a mapped decoration field; positions are pulled before switching files and stored on save; a note whose text was deleted becomes detached) Notes in `src/Editor.tsx` + `src/Writer.tsx`: load/save `.lexy/notes.json`, highlight decorations mapped through edits, store updated offsets on save; Ctrl+Alt+M on a selection opens a short prompt and adds a note; read-only windows don't write
- [X] T064 [US4] (done) Create `src/Notes.tsx` (sidebar Notes tab per contracts/ui.md: quote, body, date, Resolve/Reopen/Delete, "Show resolved", "Text was removed" for detached; click jumps)
- [X] T065 [US4] (done: Review tab (Check grammar moved here from Home), "Compare with last version" (last commit, or newest snapshot without Git) and "Compare with…" (commits or snapshots, from the Earlier versions dialog, which now offers Compare too); the comparison covers the editor column) Create `src/CompareView.tsx` per contracts/ui.md and the Review ribbon tab in `src/Ribbon.tsx` (Check grammar, New note, Show notes, Compare with last commit, Compare with…, Export PDF with notes); Git projects compare with `git_show_file` (commit from `git_log`, or the last commit before a chosen date), others with snapshots (enable T047's "Compare")
- [X] T066 [P] [US4] (done) Tests: Vitest `notes.test.ts` (reanchor after edits before/after/inside, detach, injectTodos escaping), `wordDiff.test.ts`, `Notes.test.tsx`, `CompareView.test.tsx`; Rust real e2e: `export_pdf_with_notes` writes `main (notes).pdf` and leaves `.lexy-shown` unchanged (skips without MiKTeX)
- [X] T067 [US4] (passed 2026-11-14: 157 Rust incl. a real notes PDF compile with todonotes, 521 Vitest, tsc, build; browser pane at 800x600 with a stub backend: 7 ribbon tabs and 4 side tabs fit, a stale note re-anchors by its quote, snapshot comparison shows the change. Native quickstart E pending) **Gate E**: `cd src-tauri; cargo test` and `npm test` once; fix failures; walk quickstart E; update TRACKER F-069 + Verification Log

---

## Phase 8: US6 Settings (P3) — Batch F

**Goal**: one Settings screen over the batch-0 store.
**Independent test**: quickstart F.

- [X] T068 [US6] (done: full-window page on File → Settings and Ctrl+,; numbers apply on blur/Enter and clamp; invalid image folder or non-https server shows an inline error and isn't stored; Reset all settings in About) Create `src/SettingsDialog.tsx` per contracts/ui.md and research R15.8 (single column ≤ 1000 px, sections Appearance / Editing / Preview / Grammar / Files / About, toggles, theme combo "Use system setting" / "Light" / "Dark", immediate apply, Esc/Back closes); File → Settings and Ctrl+, in `src/Writer.tsx`
- [X] T069 [US6] (done: theme via `data-theme` on `<html>` (CSS dark block now also keyed on it), editor font size via `--editor-font-size`, preview delay via the scheduler's new `setDelay`; spell language and image folder were already live) Apply settings live: theme via `data-theme` on `<html>` (CSS variables in `src/App.css` for forced light/dark, system = current media query), editor font size, `livePreviewDelayMs` into `src/livePreview.ts` options, spell language, image folder; other windows reload on focus (already in `useSettings`)
- [X] T070 [P] [US6] (done: plus scheduler and provider tests) Vitest `SettingsDialog.test.tsx` (each control writes `setSettings`; invalid font size clamps) and Writer tests (theme attribute, preview delay passed to the scheduler)
- [X] T071 [US6] (passed 2026-11-14: 530 Vitest, build; browser pane at 800x600: the page fills the window with no sideways scroll, Theme → Dark switches the page and is stored. Found and fixed: the page inherited the 420 px dialog-card width. Native quickstart F pending) **Gate F**: `npm test` once; fix failures; walk quickstart F; update TRACKER F-071 (+ close F-033) + Verification Log

---

## Phase 9: US7 Export to Word and HTML (P3) — Batch G

**Goal**: Pandoc-based export with consent and an approximation report.
**Independent test**: quickstart G.

- [X] T072 [US7] (done: Pandoc 3.13, released 2026-10-26 — 3.14 was two days old; SHA-256 from GitHub's asset digest; 42,983,200 bytes) In `src-tauri/src/export.rs`: pinned `PANDOC_VERSION`, download URL (official GitHub release, Windows x86_64 ZIP) and `PANDOC_SHA256` (look up and pin at implementation time); `converter_status`, `install_converter` (reuse `setup.rs` download/verify/unzip with `converter-progress` events), `export_document` per contracts/commands.md (120 s timeout, hidden console, `--resource-path`, `--citeproc` when a `.bib` is referenced, `--mathml` for HTML, warnings from stderr); register in `lib.rs`
- [X] T073 [P] [US7] (done) In `src/compile.ts` add `converterStatus`, `installConverter`, `exportDocument`, `ExportReport`, and a `converter-progress` listener
- [X] T074 [US7] (done: File → Export menu (Word document / Web page) and palette; result shown in an InfoBar, the first one in the Writer) File → Export → Word document / Web page in `src/Ribbon.tsx` + `src/Writer.tsx`: save all first; when not installed show the consent dialog ("Export needs Pandoc (35 MB). Download and install it?" Download / Cancel), progress InfoBar, then export; result InfoBar with "Open" (`open_entry_external`) and "N parts were approximated" + "Show details"
- [X] T075 [P] [US7] (done: install against a local server with a fake ZIP (hash, layout, progress); the real conversion test skips without Pandoc and did skip here) Rust tests: `install_converter` against a local HTTP server (hash mismatch refused, progress events, traversal-safe unzip); real e2e `export_document` for docx and html on a small project (skips without Pandoc and MiKTeX); Vitest for the consent → progress → done flow
- [X] T076 [US7] (passed 2026-11-14: 162 Rust, 532 Vitest, tsc, build; browser pane at 800x600: File tab fits, the result bar offers Open and Show details. Not run: the real 43 MB download and a real conversion. Native quickstart G pending) **Gate G**: `cd src-tauri; cargo test export` and `npm test` once; fix failures; walk quickstart G; update TRACKER F-072 + Verification Log

---

## Phase 10: Windows design alignment (cross-cutting) — Batch W

**Goal**: existing and new UI follow the Windows guidelines in research R15 / DESIGN.md. Can start any time after Phase 2.
**Independent test**: quickstart W.

- [X] T077 [P] (done: `--type-caption/body/subtitle/title` and `--weight-strong` tokens; every px/rem size mapped onto the ramp; only the Git panel's close glyph (16 px) and rendered math (15 px) stay fixed) In `src/App.css` add type-ramp tokens (`--type-caption: 12px/16px`, `--type-body: 14px/20px`, `--type-subtitle: 20px/28px`, `--type-title: 28px/36px`, weight 600 for strong) and move body text from 15 px to 14 px; replace `font-weight: bold`/`700` emphasis with 600; check nothing below 12 px
- [X] T078 (done: `windowsOrder` in `useChoice` (primary first, safe last), Cancel moved last in 7 dialogs, prompt button is a verb (`promptAction`), focus starts on the safe choice for destructive actions (permanent delete)) Dialog button order and wording in `src/ProjectDialogs.tsx`, `src/ribbon/EquationDialog.tsx`, `src/ribbon/MarginsDialog.tsx`, `src/ribbon/TablePicker.tsx` (dialog part), `src/GitPanel.tsx` prompts and `src/SetupScreen.tsx`: primary (accent, Enter) first, Cancel last (Esc); specific verbs instead of "OK"; initial focus never on a destructive button; update affected tests
- [X] T079 (done in Writer and Project Home; the old `.notice` styles were removed) Migrate notices to `InfoBar` in `src/Writer.tsx`: project folder missing (error, not closable), stale preview (warning), Bangla font offer (default), read-only window (warning), outside-change Reload / Keep mine (warning); update `src/Writer.test.tsx` selectors
- [X] T080 [P] (done: no changes needed — all strings are sentence case or proper names) Sentence-case and copy audit of every visible string in `src/*.tsx` and `src/ribbon/*.tsx` against DESIGN.md "Copy style"; fix and update tests
- [X] T081 (done: F6/Shift+F6 cycle ribbon → side panel → editor → PDF → drawer; the PDF pane became focusable; focus mode keeps no Esc exit, Esc belongs to the editor) Keyboard: F6 / Shift+F6 pane cycling (ribbon → sidebar → tabs/editor → PDF → drawer) in `src/Writer.tsx`; verify Esc closes only transient UI (menus, dialogs, palette, search, focus mode); tooltips show shortcuts from the action registry and never carry errors
- [X] T082 [P] (done) High contrast: `@media (forced-colors: active)` block in `src/App.css` (borders `CanvasText`, focus ring and selection `Highlight`/`HighlightText`, problem/spell markers keep underline styles; `forced-color-adjust: none` only on the PDF canvas)
- [X] T083 [P] (done: 41 checks, light and dark. Found and fixed: light `--text-faint` (line numbers) was 2.7:1 → #8f887e (3.4:1); `--border-strong` is ~1.75:1, so text fields and selects got their own `--control-border` (≥ 3:1) via a zero-specificity `:where()` rule; `--border-strong` stays decorative) Contrast test `src/test/contrast.test.ts`: parse the `:root` and dark-mode variables from `src/App.css` and assert ≥ 4.5:1 for text/background pairs (`--text` on `--bg`/`--surface`/`--editor-bg`, `--text-muted` on `--bg`/`--surface`, `--danger-text` on `--danger-bg`, `--warn-text` on `--warn-bg`, `--ok-text` on `--ok-bg`, `--accent-text` on `--accent`; `--text-faint` only for non-essential text at ≥ 3:1) and ≥ 3:1 for focus ring and borders against their backgrounds
- [X] T084 (done: Alt then letter shows key tips and opens the tab; Alt+letter works directly outside text fields; tabs carry `aria-keyshortcuts`) Access keys (P3): pressing Alt shows key tips on ribbon tabs (F File, H Home, N Insert, P Layout, R Review, W View, G Git) and Alt+letter opens the tab, in `src/Ribbon.tsx`; key tips hide on Esc or the next key
- [X] T085 (passed 2026-11-14: 582 Vitest, tsc, build; browser pane at 800x600 light and dark: all 7 ribbon tabs fit, 14 px body, InfoBars. Not covered: a Windows contrast theme in the native window, 125/150 % scaling) **Gate W**: `npm test` and `npm run build` once; fix failures; walk quickstart W (light, dark, a Windows contrast theme, 800x600); update TRACKER F-073 + Verification Log

---

## Phase 11: Polish

- [X] T086 [P] (done: CLAUDE.md commands, notes-file exception, panels, theming/dialog rules and a spec 007 bullet; DESIGN.md shortcuts were updated batch by batch) Update `CLAUDE.md` (Architecture: `project_texts` + TS index, new modules and commands, notes file exception, snapshots, settings, Pandoc) and `docs/DESIGN.md` (shortcuts added in this feature)
- [X] T087 (done as `src/test/performance.test.ts`, 500 files / 3.1 MB generated in memory: index 66 ms cold, 3 ms after an edit; suggestions ≤ 1 ms; search 1–7 ms (a common phrase hits the 5,000 cap); word count 143 ms. Not measured: loading the texts over IPC in the WebView) Performance checks with a generated 500-file / 1,000-page project (script in `src/test/` or a Rust test helper): suggestions < 100 ms (SC-001), project search < 1 s (SC-005), outline refresh < 2 s; record in the TRACKER Verification Log
- [X] T088 (done 2026-11-14: 162 Rust, 587 Vitest, tsc, build. Data-safety pass as a Writer test (auto-save → Replace all → note → restore): every write of the document is one of the texts the user saw, notes never enter it. Found and fixed: notes with `?` or `:` were refused by the file-name check of the shared prompt. The close/reopen part needs the native window) Final full run: `cd src-tauri; cargo test`, `npm test`, `npm run build`; data-safety pass for SC-008 (auto-save + replace + notes + snapshot restore in one session, then close/reopen) recorded in the Verification Log

---

## Dependencies

- Phase 1 → Phase 2 (Gate 0) → stories. Stories are independent after Gate 0, in this order by default: US1 → US2 → US5 → US3 → US4 → US6 → US7.
- US4 Compare for non-Git projects needs US5 snapshots (T043). US6's screen needs the settings used by US1/US2/US5 to exist (the store itself is in Phase 2).
- Batch W only needs Phase 2 (InfoBar) and can run in parallel with any story, but T078/T079 touch `Writer.tsx` and dialogs: don't run them at the same time as a story editing those files.
- Same-file order: `Writer.tsx` T012 → T026 → T033 → T037 → T038 → T046 → T047 → T054 → T063 → T074 → T079 → T081; `Editor.tsx` T024 → T025 → T035 → T039 → T063; `Sidebar.tsx` T034 → T045 → T064; `project.rs` T005 → T042 → T062; `web.rs` T022 → T052.

## Parallel examples

- Phase 2: T006, T008, T009, T011, T013 together after T005/T007 are started.
- US1: T016, T019, T020, T023 together; then T017/T018; T027 and T028 together.
- US2: T030, T031 together, then T032 → T033; T036 alongside T034.
- US3: T050, T051, T055 together.
- US4: T060, T061 together.
- W: T077, T080, T082, T083 together.

## Implementation strategy

MVP = Phase 1 + 2 + US1 (writing aids act on every keystroke). Then US2 (navigation). Ship after each gate; US5 before US3/US4 for data safety; US6/US7 last. Batch W can be done early as its own small release since it is independent and improves every screen.
