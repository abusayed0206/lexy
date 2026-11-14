# Implementation Plan: Writing Toolkit

**Branch**: `007-writing-toolkit` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-writing-toolkit/spec.md`, plus the Windows app design guidelines (https://learn.microsoft.com/en-us/windows/apps/design/guidelines-overview) the user asked to follow.

## Summary

Seven independently shippable stories that turn Lexy's editor into a complete writing tool: writing aids (suggestions, `\end` auto-close, spell/grammar check, word count, hover math, tidy), navigation (outline, tabs, folding, command palette, project find/replace, focus mode, Vim), content (citations + DOI, images, templates), review (notes, compare), files and safety (duplicate/copy/paste, auto-save, snapshots), a Settings screen, and Word/HTML export. A cross-cutting batch aligns the existing UI with the Windows design guidelines (dialog button order, type ramp, InfoBar notices, keyboard conventions, high contrast).

Technical approach, in one line per layer:

- **Rust** stays the only filesystem/network/process owner: one new `project_texts` command feeds every project-wide feature; small commands for spell check (offline Hunspell dictionary), grammar (LanguageTool, opt-in), DOI lookup, copy/duplicate, snapshots, settings, notes PDF and Pandoc export.
- **TypeScript** does all LaTeX understanding as pure, unit-tested functions in `src/latex/` (index, readable text, outline, completions, environments, tidy, word count, notes anchoring, word diff) over the texts Rust returns plus unsaved buffers, so one parser serves suggestions, outline, search, word count and spell check.
- **UI** extends the existing Writer/Sidebar/Editor/Ribbon; new panels follow `docs/DESIGN.md` and its new "Windows design alignment" section.

## Technical Context

**Language/Version**: Rust 2021 (Tauri 2), TypeScript 5.8 + React 19

**Primary Dependencies**: existing (`codemirror` 6 incl. `@codemirror/autocomplete`, `@codemirror/language`, `@codemirror/lint`, KaTeX, pdf.js, `ureq`, `zip`, `sha2`, `notify-debouncer-full`, `trash`). New: `@replit/codemirror-vim` (npm, US2), `spellbook` (Rust Hunspell-compatible checker, US1) with a bundled `en_US` dictionary, Pandoc (downloaded on first export, pinned version + SHA-256, US7). See [research.md](research.md).

**Storage**: `%LOCALAPPDATA%\Lexy\settings.json` (settings), `%LOCALAPPDATA%\Lexy\dictionary.txt` (personal words), `%LOCALAPPDATA%\Lexy\Snapshots\<hash(root)>\` (snapshots), `%LOCALAPPDATA%\Lexy\Tools\Pandoc\` (converter), `<project>\.lexy\notes.json` (notes: the one deliberate in-project file, per spec assumption).

**Testing**: Vitest for every `src/latex/*` function and the new components (Writer tests keep mocking backend wrappers, Editor and PdfView); `cargo test` for each new command (temp folders, a local HTTP server for DOI/grammar/Pandoc downloads as in `setup.rs` tests) plus real e2e that compiles every bundled template and the notes PDF (skips without MiKTeX).

**Target Platform**: Windows 10/11 desktop (WebView2)

**Project Type**: desktop app (`src-tauri/` + `src/`)

**Performance Goals**: suggestions < 100 ms on a 500-file project (SC-001); project search < 1 s over 500 files (SC-005); outline/index refresh < 2 s after an edit; spell check of a visible viewport < 50 ms.

**Constraints**: React owns presentation only; every new file operation takes project-relative paths through `resolve_in_project`; nothing leaves the machine unless the user turned it on (FR-024); no silent downloads (Pandoc needs consent + progress); 800x600 in light, dark and high contrast; every action in the command palette (FR-023); read-only windows disable writes.

**Scale/Scope**: 500 files / 1,000 pages per project; 7 stories, ~24 FRs, plus the Windows alignment batch.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template; gates are the engineering rules in `docs/PLAN.md` / `CLAUDE.md` and the UI rules in `docs/DESIGN.md`.

| Rule | Status |
|------|--------|
| React presentation only; Rust owns files, network and processes | Pass. File reads (`project_texts`), DOI/grammar HTTP, Pandoc, snapshots and settings are Rust commands; TS only parses text it was given. |
| Project paths only through `resolve_in_project`; no absolute-path commands inside a project | Pass. `copy_entry`, `project_texts`, image import and notes use project-relative paths. Snapshots/settings live under `%LOCALAPPDATA%\Lexy`. |
| Typed commands, structured errors | Pass. New structs in [contracts/commands.md](contracts/commands.md), mirrored in TS; project errors reuse `ProjectError`. |
| No `.unwrap()` on recoverable paths | Pass (design). |
| Untrusted process output; time out; validate | Pass. Pandoc runs through `run_with_timeout` (120 s), hidden console; DOI/grammar responses are size-capped and parsed defensively. |
| Never silently download/execute; pinned, hash-verified | Pass. Pandoc ZIP pinned by version + SHA-256 and installed only after a consent dialog with size and progress. The `en_US` dictionary is bundled (no download). |
| Minimal capabilities | Pass. No new Tauri plugins or permissions. |
| Nothing written into project folders | One documented exception: `.lexy/notes.json` (spec assumption; user content). Images and templates are user-initiated writes. |
| DESIGN.md: 800x600, keyboard, short copy, light/dark | Pass, extended with the Windows alignment rules (R15). |

Post-design re-check: passes. One new npm package, one new crate, one on-demand tool; no new capabilities.

## Project Structure

### Documentation (this feature)

```text
specs/007-writing-toolkit/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R16 decisions
├── data-model.md        # entities and their rules
├── quickstart.md        # validation walk per batch
├── contracts/
│   ├── commands.md      # new/changed Tauri commands
│   └── ui.md            # panels, shortcuts, copy
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
src-tauri/src/
├── lib.rs           # register commands; settings/state wiring
├── project.rs       # project_texts, copy_entry, snapshot hook in write_file
├── spell.rs         # NEW: spellbook dictionary, personal words, spell_check / spell_suggest / dictionary_add
├── web.rs           # NEW: fetch_doi, grammar_check (opt-in), shared capped HTTP helper
├── snapshots.rs     # NEW: take/list/read snapshots outside the project
├── settings.rs      # NEW: get_settings / set_settings (settings.json)
└── export.rs        # NEW: Pandoc install (consent, pinned), export_document, export_pdf_with_notes
src/
├── latex/
│   ├── readable.ts     # NEW: readable-text ranges (skip commands, math, labels, keys, URLs, comments)
│   ├── index.ts        # NEW: project index (macros, labels, bib entries, outline) from texts
│   ├── commands.ts     # NEW: built-in command/environment completion list
│   ├── completions.ts  # NEW: CompletionSource over index + built-ins
│   ├── environments.ts # NEW: \begin → \end auto-close and name sync
│   ├── tidy.ts         # NEW: re-indent (verbatim-safe)
│   ├── wordCount.ts    # NEW
│   ├── folding.ts      # NEW: foldService for sections and environments
│   ├── search.ts       # NEW: project search/replace over texts + buffers
│   ├── figure.ts       # NEW: figure block + graphicx preamble edit
│   ├── citations.ts    # NEW: bib parsing helpers, unique key, \cite insert, bibliography setup
│   ├── notes.ts        # NEW: anchor mapping, detached detection, \todo injection for notes PDF
│   └── wordDiff.ts     # NEW: word-level diff for Compare
├── actions.ts          # NEW: action registry (palette + ribbon + shortcuts share it)
├── settings.ts         # NEW: settings wrapper + React context
├── InfoBar.tsx         # NEW: Windows-style inline notice (severity, text, actions, close)
├── EditorTabs.tsx      # NEW: tab strip above the editor
├── Outline.tsx         # NEW: sidebar Outline tab
├── CommandPalette.tsx  # NEW
├── ProjectSearch.tsx   # NEW: Ctrl+Shift+F panel
├── Notes.tsx           # NEW: sidebar Notes tab
├── CompareView.tsx     # NEW: read-only track-changes view
├── SettingsDialog.tsx  # NEW
├── ribbon/CitationDialog.tsx, ribbon/DoiDialog.tsx, TemplateGallery.tsx  # NEW (US3)
├── templates/          # NEW: article, report, letter, cv, beamer .tex (imported with ?raw; passed to create_project as the starter)
├── Editor.tsx          # extensions: completions, environments, folding, hover math, spell lint, vim compartment
├── Sidebar.tsx         # Files | Outline | Notes tabs; Duplicate / Copy / Paste
├── Writer.tsx          # wiring, status bar (word count, Vim mode), focus mode, auto-save, F6
├── Ribbon.tsx          # new buttons (Citation, Image, Tidy, Check grammar, Notes, Compare, Export, Settings)
├── ProjectDialogs.tsx  # button order per Windows guidelines
└── App.css             # type ramp tokens, InfoBar, tabs, palette, forced-colors
```

**Structure Decision**: extend the existing two-tree layout. One TS module per LaTeX concern in `src/latex/` (pure, tested), one Rust module per backend concern. No new layers.

## Delivery Batches (similar features together, one test run each)

| Batch | Story | Features | Test gate |
|-------|-------|----------|-----------|
| 0 | Foundation | `project_texts`, `src/latex/index.ts` + `readable.ts`, action registry, settings store, InfoBar | `cargo test` + `npm test` |
| A | US1 Writing aids | suggestions, `\end` auto-close + sync, spell check, word count, hover math, tidy, grammar (opt-in) | `cargo test spell web` + `npm test`; quickstart A |
| B | US2 Navigation | outline tab, editor tabs, folding, palette, project find/replace, focus mode, Vim | `npm test` + `npm run build`; quickstart B at 800x600 |
| C | US5 Files and safety | duplicate/copy/paste, auto-save, snapshots | `cargo test` + `npm test`; quickstart C |
| D | US3 Content | citation picker, DOI, image insert/drop, template gallery | `cargo test` (templates e2e) + `npm test`; quickstart D |
| E | US4 Review | notes, notes PDF, compare (Git + snapshots) | `cargo test` + `npm test`; quickstart E |
| F | US6 Settings | Settings screen over the store from batch 0 | `npm test`; quickstart F |
| G | US7 Export | Pandoc consent install, Word/HTML export + report | `cargo test export` + `npm test`; quickstart G |
| W | Windows alignment | dialog order, type ramp, sentence case, InfoBar migration, Esc/F6, high contrast, contrast check | `npm test` + `npm run build`; quickstart W in light/dark/high contrast |

US5 moves ahead of US3/US4 because auto-save and snapshots are prerequisites for the "no lost text" criterion (SC-008) that notes and replace rely on. Batch W can run any time after batch 0 (it touches styling and dialogs, not features).

## Complexity Tracking

| Exception | Why needed | Simpler alternative rejected because |
|-----------|------------|--------------------------------------|
| `.lexy/notes.json` inside the project | Notes are user content and must travel with Git and folder copies (spec assumption). | Storing under `%LOCALAPPDATA%` loses notes when the folder moves or is cloned. |
| On-demand Pandoc download (~35 MB) | Word/HTML export needs a real converter. | Writing a LaTeX→DOCX converter is far larger and worse; bundling bloats every install for a P3 feature. |
