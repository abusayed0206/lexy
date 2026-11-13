# Lexy Feature Tracker

Last updated: 2026-11-13

This tracker is the source of truth for implementation status. Any contributor working here for the first time must read this file, `docs/PLAN.md`, and `docs/DESIGN.md` before making changes.

## Status Legend

| Status | Meaning |
| --- | --- |
| Done | Implemented and verified. |
| In Progress | Work exists but is incomplete or not fully verified. |
| Not Started | No meaningful implementation yet. |
| Blocked | Cannot proceed without a decision, dependency, or access. |
| Manual | Manually added idea or requirement awaiting triage. |

## Current Implementation Snapshot

| Area | Status | Evidence |
| --- | --- | --- |
| Tauri 2 scaffold | Done | `src-tauri`, `tauri.conf.json`, `package.json` exist. |
| React/Vite scaffold | Done | `src`, `vite.config.ts`, React dependencies exist. |
| Lexy product identity | In Progress | Package/app name is `lexy`; README and UI still use template copy. |
| Minimal LaTeX writer UI | In Progress | M1 writer shell implemented (`src/Writer.tsx`): editor, blank preview, status, log drawer; compile is a stub. Live app check pending. |
| Rust LaTeX commands | In Progress | Initial setup and environment detection commands exist; compile command not implemented. |
| MiKTeX integration | In Progress | Detection and initial unattended setup flow exist; VM validation still required. |
| Strawberry Perl integration | In Progress | Detection and silent MSI setup flow exist; portable option not implemented. |
| Windows installer polish | Not Started | Tauri bundling is enabled, but no installer strategy is configured. |

## Feature Tracker

| ID | Feature | Priority | Status | Owner | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| F-001 | Replace template README with Lexy onboarding | P0 | Done | Codex | File review | Links plan, design, tracker, and setup commands. |
| F-002 | Remove default Tauri greeting UI | P0 | Done | Codex | `npm run build` | Replaced by initial setup screen. |
| F-003 | Set app metadata and window title to Lexy | P0 | In Progress | Codex | `npm run tauri dev` | HTML title updated; Tauri/package metadata still needs polish. |
| F-004 | Minimal split editor/preview layout | P0 | In Progress | Claude | Browser visual check | Implemented in `src/Writer.tsx` (spec `specs/001-writer-shell`); 800x600/scaling check pending. |
| F-005 | Starter LaTeX document | P0 | In Progress | Claude | App launch | `src/starter.ts` loaded into the editor; live launch check pending. |
| F-006 | Manual compile button | P0 | In Progress | Claude | Compile smoke test | Compile (and F5) saves, then runs `compile_document`; real latexmk compile verified by Rust e2e test; native-window click-through pending. |
| F-007 | Debounced auto compile toggle | P1 | In Progress | Claude | UI interaction test | Live preview (View tab, default on): compiles a snapshot ~1 s after typing, one running + one queued. Unit/UI-tested; native check pending. |
| F-008 | Compile status indicator | P0 | In Progress | Claude | UI state review | Idle/Changed/Compiling/PDF ready/Compile failed via reducer in `src/Writer.tsx`; compile is an M1 stub. |
| F-009 | Collapsible log panel | P0 | In Progress | Claude | Compile failure test | Collapsed by default, Ctrl+L toggle, opens on failed compile, Copy log. Live check pending. |
| F-010 | Open `.tex` file | P0 | In Progress | Claude | Manual file test | Dialog plugin + `read_document` (abs .tex only, 10 MiB cap, UTF-8 only). Unit-tested; native dialog check pending. |
| F-011 | Save current `.tex` file | P0 | In Progress | Claude | Manual file test | `write_document` is atomic (temp + fsync + rename); exact round-trip Rust-tested. Native check pending. |
| F-012 | Save as `.tex` file | P0 | In Progress | Claude | Manual file test | Appends `.tex` if the user omits it. Unit-tested; native check pending. |
| F-013 | Dirty state tracking | P0 | In Progress | Claude | UI state test | Unsaved dot by file name; confirm before New/Open/close (`onCloseRequested`). Unit-tested; native close check pending. |
| F-014 | Recent files | P2 | Not Started | Unassigned | App relaunch | Store in app config data. |
| F-015 | Rust workspace service | P0 | Done | Claude | Rust tests | `read_document` / `write_document` in `src-tauri/src/lib.rs`; `cargo test` covers validation, limits, atomic write. |
| F-016 | Rust compiler service | P0 | Done | Claude | Rust tests + smoke test | `compile_document`: latexmk with -outdir build folder, tool PATH, hidden console, 180 s tree-kill timeout, first-error summary. Real compile e2e test passed on dev machine. |
| F-017 | Compile job cancellation/queue | P1 | In Progress | Claude | Rapid edit test | Compile disabled while running (F5 ignored) and timed out after 180 s; no user-facing cancel yet. |
| F-018 | PDF preview refresh | P0 | In Progress | Claude | Successful compile test | pdf.js canvases, double-buffered, scroll kept; last good PDF kept on failure. Unit-tested; native WebView2 check pending. |
| F-019 | MiKTeX detection | P0 | In Progress | Codex | Machine with MiKTeX | Detects `miktex`; package behavior check still needed. |
| F-020 | Strawberry Perl detection | P0 | In Progress | Claude | Machine with Perl | Detects Lexy's portable Perl first, then `C:\Strawberry`, then PATH. |
| F-021 | `latexmk` detection | P0 | In Progress | Codex | Machine with MiKTeX | Detects `latexmk --version`. |
| F-022 | Dependency setup screen | P0 | In Progress | Codex | Fresh machine UI test | Initial screen exists; needs browser and VM validation. |
| F-023 | App-managed dependency install | P0 | In Progress | Claude | Fresh VM test | Per-user, no admin: portable Strawberry Perl ZIP + MiKTeX standalone setup (`src-tauri/src/setup.rs`). Fixes MSI exit 1603. Native run pending. |
| F-024 | Dependency hash verification | P0 | In Progress | Claude | Unit/integration test | Perl ZIP pinned (SHA-256, streamed check). MiKTeX setup has only a rolling URL, so unpinned. |
| F-025 | Setup progress reporting | P1 | In Progress | Claude | Setup test | Per-step states, byte progress with speed/ETA, live MiKTeX output, overall bar. Unit-tested; native run pending. |
| F-026 | Setup log access | P1 | In Progress | Claude | Failure test | `setup.log` + Show details / Copy log on the setup screen. |
| F-027 | Tauri capabilities for shell/files | P0 | Done | Claude | Capability review | Added only `dialog:default` and `core:window:allow-destroy`; file and process work stays in Rust commands, no fs/shell plugins. |
| F-028 | Windows installer target decision | P0 | Blocked | Product | Decision recorded | NSIS vs MSI vs both. |
| F-029 | Bundle dependency resource decision | P0 | Blocked | Product/Engineering | Decision recorded | Bundle installers or download on demand. |
| F-030 | WebView2 installer mode decision | P1 | Blocked | Engineering | Build review | Tauri supports download/offline/fixed runtime modes. |
| F-031 | App update strategy | P2 | Not Started | Unassigned | Release plan review | Decide after MVP installer works. |
| F-032 | Keyboard shortcuts | P1 | In Progress | Claude | Manual shortcut test | Ctrl+N/O/S, Ctrl+Shift+S, F5 compile, Ctrl+L logs; capture-phase so they beat CodeMirror. Unit-tested; native check pending. |
| F-033 | Minimal settings screen | P2 | Not Started | Unassigned | UI review | Dependency paths, auto compile, theme. |
| F-034 | Accessibility pass | P1 | In Progress | Claude | Keyboard/display scaling test | Named icon buttons with shortcut tooltips, focus order, keyboard-resizable splitter, text status labels. 125/150% scaling check pending. |
| F-035 | Fresh Windows VM smoke test | P0 | Not Started | Unassigned | VM checklist | No MiKTeX/Perl preinstalled. |
| F-036 | Release checklist | P1 | Not Started | Unassigned | File review | Build, install, setup, compile, uninstall. |
| F-037 | Word-style ribbon (File/Home/Insert/Layout/View) | P1 | In Progress | Claude | UI tests + native check | `src/Ribbon.tsx`; tablist keyboard pattern; icon-only below 900 px. Native check pending. |
| F-038 | Document font and size (built-in + installed fonts) | P1 | In Progress | Claude | Settings round-trip tests + XeLaTeX e2e | Lexy settings block; installed fonts via fontdb + XeLaTeX marker. Native check pending. |
| F-039 | Equation editor with live math preview | P1 | In Progress | Claude | Dialog tests | KaTeX preview, palette, inline/display, edit existing equation. Native check pending. |
| F-040 | Insert table (grid + dialog) | P2 | In Progress | Claude | Generator + dialog tests | Empty cells (no placeholders) so live preview keeps compiling. Native check pending. |
| F-041 | Page layout: margins, paper, orientation | P1 | In Progress | Claude | Settings tests | Word presets + custom 0.5–6 cm. Native check pending. |
| F-042 | Default save folder Documents\Lexy | P1 | In Progress | Claude | Rust + UI tests | `default_document_folder` (FOLDERID_Documents, created on demand, home fallback). Native check pending. |
| F-043 | Formatting commands (bold/italic/underline, headings, lists, page break, footnote) | P2 | In Progress | Claude | Generator + UI tests | One undo step each; Ctrl+B/I/U. Native check pending. |
| F-044 | Project folders and file names | P1 | In Progress | Claude | Rust + UI tests | Saving into Documents\Lexy creates `Lexy\Name\Name.tex` (never overwrites: `Name (2)`); name suggested from `\title`. Native check pending. |
| F-045 | PDF saved next to the document on exit | P1 | In Progress | Claude | Rust + UI tests | PDF lives in the build folder while editing; on close it is written as `<name>.pdf` beside the saved `.tex` (recompiled first if the preview doesn't match the saved text). Native check pending. |

## Manual Feature Intake

Add new ideas here first. During triage, either move them into the feature tracker with an ID or mark them rejected with a reason.

| Date | Author | Manual Feature | Why It Matters | Triage |
| --- | --- | --- | --- | --- |
| 2026-06-10 | Codex | Choose installer target: NSIS, MSI, or both. | Affects packaging, enterprise install behavior, and setup UX. | Needs decision |
| 2026-06-10 | Codex | Choose editor engine: textarea, CodeMirror, or Monaco. | Affects app weight and LaTeX editing capability. | Resolved 2026-11-13: CodeMirror 6 |
| 2026-06-10 | Codex | Choose PDF preview strategy. | Affects file permissions, refresh behavior, and app size. | Resolved 2026-11-13: blob URL iframe |
| 2026-06-10 | Codex | Decide whether to switch Strawberry Perl from MSI to portable. | Portable may better match no-GUI app-managed setup, but asset URL and extraction flow need confirmation. | Resolved 2026-11-13: portable ZIP |

## Decision Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-06-10 | Use Tauri 2 + React + Rust as the app foundation. | Current scaffold already uses this stack and it fits a small Windows desktop app. |
| 2026-06-10 | Treat `PLAN_draft.md` as historical input, not the source of truth. | The draft includes useful direction but also unsafe installer assumptions and template-level snippets. |
| 2026-06-10 | Require Context7 checks for external framework/package docs before implementation decisions. | User requested updated docs; packaging and permissions change over time. |
| 2026-06-10 | Use MiKTeX standalone setup utility with a local basic package repository for initial setup. | Official MiKTeX deployment docs recommend `miktexsetup_standalone` for unattended deployment. |
| 2026-11-13 | M1 Compile is a frontend stub (`src/compile.ts`) returning a clear "not available yet" failure in the result shape M3's Rust command must return. | Keeps the error state and auto-open log testable in M1; M3 swaps one function body. |
| 2026-11-13 | Real compile replaces the M1 stub; compile saves the document first. | latexmk reads from disk; saving on compile is an explicit user action, so no hidden writes. |
| 2026-11-13 | Compile shortcut is F5 (not Ctrl+B). | Ctrl+B is "bold" in most editors; F5 does not conflict with text editing, and the handler also stops the webview reload. |
| 2026-11-13 | Build output goes to `%LOCALAPPDATA%\Lexy\Build\<hash>`, not beside the document. | Keeps user folders free of aux files; lets `read_pdf` refuse anything outside one root. |
| 2026-11-13 | PDF preview = `read_pdf` raw bytes → blob URL in an iframe (WebView2 built-in viewer). | No asset protocol or fs scope needed; backend controls which files are readable. |
| 2026-11-13 | Editor = CodeMirror 6 with legacy `stex` mode; Ctrl+L stays "toggle logs" over CodeMirror select-line. | Highlighting, line numbers, bracket matching; DESIGN.md already assigns Ctrl+L. |
| 2026-11-13 | Dark theme follows the Windows app theme via `prefers-color-scheme`; no in-app toggle yet. | Smallest change; a Settings toggle can come with F-033. |
| 2026-11-13 | Word-style ribbon over visible LaTeX source (not WYSIWYG). | User asked for "slightly like MS Word"; keeps files portable (spec 002, research R1). |
| 2026-11-13 | Document settings live in a marked block in the `.tex` preamble; installed fonts switch to XeLaTeX via `% !TEX program = xelatex`. | Settings travel with the file; Lexy only edits lines it owns (research R2–R4). |
| 2026-11-13 | All compiles use `compile_source` snapshots in the build folder; the user's file is only written by Save. | Live preview must not write user files (PLAN P5); one code path for live and explicit compiles (research R5). |
| 2026-11-13 | Preview renders with pdf.js instead of the WebView PDF viewer. | Live refresh without flashing or losing the scroll position (research R6). |
| 2026-11-13 | Equation field is a plain textarea (not a nested CodeMirror) with KaTeX preview; tables insert empty cells instead of `□` placeholders. | Smaller, accessible; pdfLaTeX can't typeset `□`, which would break live preview. |
| 2026-11-13 | Tauri crates aligned to the npm minors (tauri 2.12.5, tauri-plugin-dialog 2.8.0). | Removes the CLI's version-mismatch error at launch. |
| 2026-11-13 | Strawberry Perl installs from the portable ZIP (pinned SHA-256) into `%LOCALAPPDATA%\Lexy\Setup\StrawberryPerl`; downloads and unzipping move from PowerShell to Rust (`ureq` with native-tls, `zip`). | The silent per-machine MSI needs admin and failed with exit 1603 and no output; Rust gives real byte progress and readable errors. |
| 2026-11-13 | One project folder per document under Documents\Lexy; the PDF is exported beside the `.tex` only on exit. | User request; keeps the project folder free of aux files and stale PDFs while editing, and the exported PDF always matches the saved text. |

## Verification Log

| Date | Command/Test | Result | Notes |
| --- | --- | --- | --- |
| 2026-06-10 | Repository inspection | Passed | Confirmed scaffold and draft plan. |
| 2026-06-10 | Context7 Tauri docs query | Passed | Confirmed Windows build command, resources, sidecars, shell capabilities. |
| 2026-06-10 | Official MiKTeX and Strawberry Perl docs review | Passed | Confirmed MiKTeX setup utility flow and Strawberry MSI/portable release types. |
| 2026-11-13 | `npm run build` | Passed | M1 writer shell typechecks and builds. Quickstart scenarios in `specs/001-writer-shell/quickstart.md` not yet run in the live app. |
| 2026-11-13 | Browser pane check of `npm run tauri dev` frontend at 800x600, backend mocked as ready | Passed | Quickstart 1–4: writer + starter article, Idle→Changed→Compiling (Compile disabled)→Compile failed, drawer auto-opens, Ctrl+L toggles, accessible names and tab order match contract; no horizontal overflow down to 640x480. Failed tool check shows setup screen with error. Not covered: native window at 125/150% scaling, real setup→writer handoff, clipboard contents. |
| 2026-11-13 | `cargo test` (src-tauri) | Passed | 53 Rust tests, including a real latexmk compile (success + `Line 3: Undefined control sequence.`) on the dev machine. |
| 2026-11-13 | `npm test` + `npm run build` | Passed | 107 Vitest tests (App gate, SetupScreen, Writer, Editor, compile/documents wrappers); typecheck and build pass. |
| 2026-11-13 | Browser pane check, backend mocked, 800x600 light + dark | Passed | F5 → save dialog → write → compile → PDF in iframe; failure shows banner + log with last PDF kept; no horizontal overflow. Not covered: native Tauri window, real dialogs, WebView2 PDF viewer, 125/150% scaling. |
| 2026-11-13 | `cargo test` (src-tauri), feature 002 | Passed | 67 Rust tests incl. real latexmk e2e: pdfLaTeX, XeLaTeX + Arial, `\input` via TEXINPUTS, no aux files beside documents; fontdb lists Arial. |
| 2026-11-13 | `npm test` + `npm run build`, feature 002 | Passed | 287 Vitest tests (settings round-trip over 504 combinations, scheduler, ribbon, dialogs, PdfView, Writer). KaTeX and the pdf.js worker are split from the main bundle. |
| 2026-11-13 | Browser pane, backend mocked, 800 and 1100 px | Passed | Ribbon fits without overflow (icon-only at 800), menus drop below the panel, font → Georgia adds the XeLaTeX marker and live-recompiles unsaved text. Not covered: PDF pixels (pane hidden, pdf.js needs requestAnimationFrame), native dialogs, quickstart in the Tauri window. |
| 2026-11-13 | `cargo test` after setup rework | Passed | 80 Rust tests: downloads against a local HTTP server (progress, checksum mismatch, 404, unreachable, reuse), ZIP extraction incl. path-traversal refusal, streamed output with last lines on failure. Real Perl URL returns 200 with the pinned size. |
| 2026-11-13 | `npm test` + `npm run build` after setup rework | Passed | 292 Vitest tests incl. new setup screen (step plan, live bytes, failure + Try again, log details). Native setup run pending. |
| 2026-11-13 | `cargo test` + `npm test` + `npm run build` (project folders, PDF on exit) | Passed | 90 Rust and 312 Vitest tests. Not yet tried in the native window. |
