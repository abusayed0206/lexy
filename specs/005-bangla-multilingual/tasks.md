---
description: "Task list for Seamless Bangla and Multilingual Documents"
---

# Tasks: Seamless Bangla and Multilingual Documents

**Input**: Design documents from `specs/005-bangla-multilingual/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included. The project rule (CLAUDE.md) is that new logic ships with unit tests, and [quickstart.md](quickstart.md) names the Rust and Vitest cases. Rust tests go in the `#[cfg(test)] mod tests` of `src-tauri/src/lib.rs`. Real-tool tests extend `compile_end_to_end_when_tools_are_installed` and print "skipping" when MiKTeX/latexmk/Perl, or the Bangla font they need, are missing.

**Organization**: By user story from spec.md: US1 (P1) engine, US2 (P1) fonts, US3 (P2) editor, US4 (P2) non-Latin names, US5 (P3) packages.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [X] T001 Add a test helper `bangla_font_installed() -> bool` in the tests module of src-tauri/src/lib.rs that returns true when `C:\Windows\Fonts\kalpurush.ttf` or `Siyamrupali.ttf` exists (system or `%LOCALAPPDATA%\Microsoft\Windows\Fonts`), so e2e cases needing a Bangla font can print "skipping" otherwise

---

## Phase 2: Foundational (blocks US1, US2, US4, US5)

- [X] T002 Refactor src-tauri/src/lib.rs so `compile_project_at` computes a single search-path value and passes it to `run_latexmk`, which sets it for `TEXINPUTS` and `BIBINPUTS` (behaviour unchanged). Rename the parameter to `search_path` so later stories add `TTFONTS`/`OPENTYPEFONTS` and the junction in one place; existing tests must pass unchanged
- [X] T003 Write the first log line `Engine: <Name> (<reason>)` in `compose_log` callers in src-tauri/src/lib.rs: add a `reason: &str` argument to `run_latexmk` and prepend the line to `CompileResult.log`; display names "pdfLaTeX", "XeLaTeX", "LuaLaTeX" (contracts/compile.md); update `compose_log` tests

**Checkpoint**: compile path has one place for search paths and reports the engine in the log.

---

## Phase 3: User Story 1 - A Bangla document just compiles (P1) 🎯 MVP

**Goal**: Documents that load LaTeXbangla or other Unicode-engine packages compile with XeLaTeX without an engine line.

**Independent Test**: LaTeXbangla `examples/bangla.tex` (no `% !TEX program` line) compiles on the first F5 with Kalpurush installed (quickstart scenario 1).

### Tests for User Story 1

- [X] T004 [US1] Unit tests in src-tauri/src/lib.rs for `choose_engine`: marker wins over packages (`% !TEX program = lualatex` + `\usepackage{latexbangla}` → Lualatex, reason marker); `\usepackage{latexbangla}` → Xelatex reason `latexbangla`; list form `\usepackage[hidelinks]{hyperref,fontspec}` → Xelatex; class `\documentclass{bookbangla}` → Xelatex; `%\usepackage{fontspec}` and `\usepackage{fontspec}` after `\begin{document}` → Pdflatex; `\%` is not a comment start; `\usepackage{babel}` → Pdflatex; plain article → Pdflatex reason default; preamble `\input{preamble}` whose text loads polyglossia → Xelatex (preamble text supplied by the caller)
- [X] T005 [P] [US1] Vitest in src/Ribbon.test.tsx: status tooltip shows `XeLaTeX · PDF ready` when state carries engine "xelatex" and status ready, and `pdfLaTeX · <summary>` on failure

### Implementation for User Story 1

- [X] T006 [US1] In src-tauri/src/lib.rs change `engine_from_marker(&str) -> Engine` to `marker_engine(&str) -> Option<Engine>` (same parsing rules; `None` when no marker or an unknown program) and update its two existing tests (unknown program / marker after line 5 now return `None`)
- [X] T007 [US1] In src-tauri/src/lib.rs add `const UNICODE_ENGINE_PACKAGES: [&str; 10] = ["latexbangla","fontspec","polyglossia","unicode-math","xeCJK","luatexja","bidi","xltxtra","xunicode","mathspec"]` and `const UNICODE_ENGINE_CLASSES: [&str; 4] = ["bookbangla","ctexart","ctexbook","ctexrep"]`, plus `fn preamble(text: &str) -> String` (comments removed: `%` to end of line unless escaped as `\%`; cut at `\begin{document}`) and `fn preamble_inputs(preamble: &str) -> Vec<String>` (arguments of `\input{…}` / `\include{…}`, `.tex` appended when missing)
- [X] T008 [US1] In src-tauri/src/lib.rs add `fn choose_engine(main_text: &str, included: &[String]) -> (Engine, String)` per data-model.md EngineChoice: "1. `% !TEX program = …` / `TS-program` in the first 5 lines → that engine. 2. Else the first package or class in the preamble that is on `UNICODE_ENGINE_PACKAGES` → `xelatex`, reason `package(name)`. 3. Else `pdflatex`, reason `default`." Names match exactly per comma-separated entry inside `\usepackage[…]{a,b,c}` / `\RequirePackage` / `\documentclass[…]{x}`; reason strings `marker`, the package/class name, or `default`
- [X] T009 [US1] Wire it into `compile_project_at` in src-tauri/src/lib.rs: read the preamble files named by `preamble_inputs` (one level) from the buffers when present, else from disk via `resolve_in_project` + `project::read_file_at`, skipping files that are missing or outside the project; pass the result to `choose_engine`; give `run_latexmk` the engine and reason
- [X] T010 [US1] Show the engine in the status tooltip: add `engine: CompileResult["engine"] | null` to `CompileState` in src/Writer.tsx (set on `done`), pass `statusEngine` in `RibbonState`, and render `title` as `<Engine name> · <label or summary>` in src/Ribbon.tsx (contracts/editor-ui.md); update the `compileReducer` tests in src/Writer.test.tsx
- [X] T011 [US1] Extend `compile_end_to_end_when_tools_are_installed` in src-tauri/src/lib.rs: when `bangla_font_installed()`, a project whose main.tex is the LaTeXbangla README example (`\usepackage{latexbangla}`, `\setbanglamainfont{Kalpurush}` or Siyam Rupali, Bangla text, no marker) compiles with `result.engine == Engine::Xelatex` and `result.ok`, and the log starts with `Engine: XeLaTeX (latexbangla)`

**Checkpoint**: the reported failure is fixed.

---

## Phase 4: User Story 2 - Any Bangla font the user has works (P1)

**Goal**: Installed fonts (all users or current user) and font files inside the project work; a missing font gets a readable summary.

**Independent Test**: `\setbanglamainfont{MyBangla.ttf}[Path=fonts/]` with the font only in `<project>\fonts\` compiles (quickstart scenario 3).

### Tests for User Story 2

- [X] T012 [P] [US2] Unit test `font_summary_*` in src-tauri/src/lib.rs: given the captured log text `(fontspec)                The font "MyBangla" cannot be found; this may be` preceded by `! Transform components aren't all known.`, the compile summary is `Font "MyBangla" not found`; split across two lines with `(fontspec)` prefixes also matches; a log without it falls back to `first_latex_error`
- [X] T013 [US2] Extend the e2e test in src-tauri/src/lib.rs: copy an installed Bangla font file to `<project>\fonts\MyBangla.ttf`, main uses `\setbanglamainfont{MyBangla.ttf}[Path=fonts/]` → ok; then `\setbanglamainfont{NoSuchFont}` → `!ok` with summary `Font "NoSuchFont" not found`
- [X] T014 [P] [US2] Unit test in src/latex/settings.test.ts: applying an installed font (`\setmainfont{Georgia}`) to a document with `\usepackage{latexbangla}` and `\setbanglamainfont{Kalpurush}` leaves both lines byte-for-byte unchanged and in place (FR-009)

### Implementation for User Story 2

- [X] T015 [US2] In `run_latexmk` (src-tauri/src/lib.rs) also set `TTFONTS` and `OPENTYPEFONTS` to the search path from T002 (research R3)
- [X] T016 [US2] In src-tauri/src/lib.rs add `fn missing_font(log: &str) -> Option<String>` (join lines, strip `(fontspec)` prefixes and runs of spaces, find `The font "X" cannot be found`) and use it before `first_latex_error` when building the summary: `Font "X" not found` (data-model.md CompileSummary patterns)

**Checkpoint**: custom fonts work from the system or the project.

---

## Phase 5: User Story 3 - Writing Bangla and other scripts in the editor (P2)

**Goal**: All scripts display, right-to-left lines read correctly, clusters move and delete as one.

**Independent Test**: Paste Bangla and Arabic into the editor; Backspace after "ক্ষ" removes it whole; the Arabic line's direction is RTL (quickstart scenario 5).

### Tests for User Story 3

- [X] T017 [P] [US3] Vitest in src/Editor.test.tsx: with doc "ক্ষ" and the cursor at the end, `deleteCharBackward` (from @codemirror/commands) leaves "" (one cluster); with "আমি" `cursorCharLeft` from the end moves to index 2 (before "মি"); `view.state.facet(EditorView.perLineTextDirection)` is true

### Implementation for User Story 3

- [X] T018 [P] [US3] Add `EditorView.perLineTextDirection.of(true)` to the extensions in src/Editor.tsx (contracts/editor-ui.md)
- [X] T019 [P] [US3] Change `--font-mono` in src/App.css to `"Cascadia Mono", "Cascadia Code", Consolas, "Nirmala UI", "Segoe UI", "Microsoft YaHei", "Yu Gothic", "Malgun Gothic", ui-monospace, monospace`
- [X] T020 [US3] Browser-pane check (mocked backend, as in spec 004): paste Bangla, Devanagari, Arabic and Chinese lines into the editor at 800x600; confirm no empty boxes, no vertical clipping at line height 1.55 (raise `.cm-scroller` line-height in src/Editor.tsx theme only if clipped), Arabic line has `dir="rtl"`; record the result in docs/TRACKER.md Verification Log

**Checkpoint**: editor handles every script.

---

## Phase 6: User Story 4 - Non-English file, folder and project names (P2)

**Goal**: Projects, main documents and included files with Bangla names compile and export.

**Independent Test**: Project "আমার প্রবন্ধ" with `\input{অধ্যায়/ভূমিকা}` compiles and exports `আমার প্রবন্ধ.pdf` (quickstart scenario 6).

### Tests for User Story 4

- [X] T021 [P] [US4] Unit tests in src-tauri/src/lib.rs: `snapshot_stem("Thesis")` → "Thesis"; `snapshot_stem("আমার প্রবন্ধ")` → "document"; `snapshot_stem("a&b")` → "document"; `is_plain_ascii` true only for 0x20–0x7E (data-model: "Plain ASCII = every character is printable ASCII (0x20–0x7E)")
- [X] T022 [US4] Unit tests in src-tauri/src/lib.rs for `tex_project_path(out_dir, root)`: ASCII root → root itself, no junction made; non-ASCII root (temp dir named "প্রকল্প") → `<out_dir>\.lexy-root` exists and `.lexy-root\x.tex` reads the project's `x.tex`; second call reuses it; pointing at another root replaces it; afterwards `fs::remove_dir_all(<out_dir>\.lexy-overlay)` and `mirror_folders` leave the project files intact; removing the out dir with `fs::remove_dir_all` leaves the project intact (research R4 safety)
- [X] T023 [US4] Extend the e2e test in src-tauri/src/lib.rs: project folder "প্রকল্প" with main "আমার প্রবন্ধ.tex" that does `\input{অধ্যায়/ভূমিকা}` (pdfLaTeX, no Bangla font needed) → ok, PDF at `<out>\document.pdf`; then `export_pdf_to` writes `আমার প্রবন্ধ.pdf` beside the main file

### Implementation for User Story 4

- [X] T024 [US4] In src-tauri/src/lib.rs add `fn is_plain_ascii(text: &str) -> bool` and `fn snapshot_stem(stem: &str) -> String` ("main file stem if plain ASCII and free of `%#&{}~^$` and spaces at ends, else `document`") and use it in `compile_project_at` for the snapshot and PDF names
- [X] T025 [US4] In src-tauri/src/lib.rs add `fn tex_project_path(out_dir: &Path, root: &Path) -> PathBuf`: plain-ASCII root → root; else ensure junction `<out_dir>\.lexy-root` → root via `cmd /C mklink /J` run through `hide_console` (remove a stale junction with `cmd /C rmdir`, never a recursive delete); on failure return root and add the log line `Could not create an ASCII link to the project folder; files with non-Latin names may not be found.` Use it for the search path from T002
- [X] T026 [US4] In `build_root()` (src-tauri/src/lib.rs) fall back to `%ProgramData%\Lexy\Build\<first 16 hex of sha256(lowercased %USERPROFILE%)>` when `%LOCALAPPDATA%\Lexy\Build` is not plain ASCII, with the comment `shortcut: ProgramData is shared by all local users; the hash keeps folders apart. Upgrade to a per-user ASCII location if this matters.`; update `read_pdf`/`export_pdf` callers (they use `build_root()` already) and add a unit test for the fallback decision with injected paths

**Checkpoint**: Bangla names everywhere work.

---

## Phase 7: User Story 5 - Missing LaTeX packages install themselves (P3)

**Goal**: No hidden install prompt; failures name the package.

**Independent Test**: Compiling with a missing package installs it without a dialog (quickstart scenario 7).

- [X] T027 [US5] In `run_latexmk` (src-tauri/src/lib.rs) add the args `-pdflatex=pdflatex -enable-installer %O %S`, `-xelatex=xelatex -enable-installer %O %S`, `-lualatex=lualatex -enable-installer %O %S` (each one argument, passed via `Command::arg` so no shell quoting) per contracts/compile.md
- [X] T028 [US5] In src-tauri/src/lib.rs add a summary pattern for failed installs (`could not be installed` / `MiKTeX could not install package X` lines in the joined log) → `Package X could not be installed (offline?)`, checked after `missing_font`; unit test with a captured-style log line
- [X] T029 [US5] Verify the e2e suite still passes with the new arguments (all engines run with `-enable-installer`): `cd src-tauri; cargo test compile_end_to_end_when_tools_are_installed`

---

## Phase 8: Polish & cross-cutting

- [X] T030 [P] Update CLAUDE.md compile notes: engine choice order and package list, `TTFONTS`/`OPENTYPEFONTS`, ASCII snapshot stem, `.lexy-root` junction (never delete recursively through it), ProgramData fallback, `-enable-installer`, `Engine:` log line
- [X] T031 [P] Update docs/DESIGN.md: scripts and RTL in the editor, Backspace deletes a whole Bangla cluster (research R8), status tooltip shows the engine
- [X] T032 [P] Update docs/TRACKER.md: new rows F-052 Unicode engine auto-choice, F-053 Project and per-user fonts, F-054 Multiscript editor, F-055 Non-Latin names, F-056 Package auto-install; intake row → "Implemented as F-052…F-056"
- [X] T033 Run `npm run build`, `npm test`, `cd src-tauri; cargo test`; then the quickstart manual scenarios 1–6 in `npm run tauri dev` with the user's Kalpurush install, and record results in docs/TRACKER.md Verification Log

---

## Dependencies & Execution Order

- T001 → T002 → T003 → stories.
- **US1 (T004–T011)** first: it is the reported failure and the MVP.
- **US2 (T012–T016)** needs T002 (search path) and the e2e Bangla case from T011.
- **US3 (T017–T020)** is frontend-only and independent of US1/US2; it can run in parallel with them.
- **US4 (T021–T026)** needs T002; T025 changes the same search path as T015, so do US2 before US4.
- **US5 (T027–T029)** touches `run_latexmk`, so do it after US2 and US4.
- **Polish (T030–T033)** last.

Inside each story: tests first (expected to fail), then implementation. Most Rust tasks edit src-tauri/src/lib.rs and are therefore sequential.

## Parallel Opportunities

- US3 (T017–T019) alongside any Rust story: different files.
- T005 (Ribbon test) alongside the Rust US1 tasks.
- T012 and T014 together (different files).
- T021 alongside T013 only if split into separate commits; same file otherwise.
- T030, T031, T032 together.

## Implementation Strategy

- **MVP = US1**: after T011, the user's LaTeXbangla example compiles with no edits. Ship or check this first.
- Then US2 (custom fonts, the user's explicit ask), US4 (Bangla names), US3 (editor), US5 (package install).
- Run `cargo test` and `npm test` at every checkpoint.
