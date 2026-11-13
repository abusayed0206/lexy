# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Lexy is a Windows-first, minimal LaTeX writer: Tauri 2 + React 19 + TypeScript (Vite) frontend, Rust backend in `src-tauri/`. It drives MiKTeX, `latexmk` and Strawberry Perl under the hood and installs them itself on first run.

## Required reading and doc workflow

The docs in `docs/` are the source of truth, not the code comments:

- `docs/PLAN.md` — architecture, milestones (M0–M6), engineering rules, open decisions.
- `docs/DESIGN.md` — UI rules (sparse native-tool look, 800x600 minimum, short operational copy, keyboard shortcuts).
- `docs/TRACKER.md` — feature status (F-001…). **Update it in the same change that implements or changes a feature.** New ideas go into its "Manual Feature Intake" table first; decisions go into its Decision Log; verification runs go into its Verification Log.
- `docs/SETUP.md` — the dependency detection/install flow, install paths and URLs.

Use Context7 for current docs before decisions that depend on Tauri, Rust crates, React, MiKTeX, Strawberry Perl, installers or Windows behavior (recorded project decision).

## Commands

```powershell
npm install
npm run tauri dev      # run the app (starts Vite on :1420 via beforeDevCommand)
npm run build          # frontend typecheck (tsc) + Vite build
npm run tauri build    # Windows installer bundle
cd src-tauri; cargo check
npm test                              # Vitest (jsdom) once; `npm run test:watch` to watch
npx vitest run src/Writer.test.tsx -t "F5 compiles"   # single file / test
cd src-tauri; cargo test               # Rust unit tests
cd src-tauri; cargo test <name>        # single test
```

No linter is configured. `compile_end_to_end_when_tools_are_installed` runs real latexmk compiles (pdfLaTeX, XeLaTeX with Arial, `\input` via TEXINPUTS) and silently passes (prints "skipping") when MiKTeX/latexmk/Perl aren't installed. Keep the npm `@tauri-apps/*` packages and the Rust `tauri*` crates on the same minor versions (the CLI warns otherwise).

## Architecture

The boundary rule (PLAN.md): React owns presentation state only; Rust owns filesystem access, process execution, dependency install and compile jobs. The frontend talks to Rust only via typed `invoke` commands, Tauri events and the dialog plugin.

- `src-tauri/src/lib.rs` holds the whole backend (setup, documents, compilation, default folder and fonts, processes) plus its `#[cfg(test)]` module. Commands: `check_environment`, `start_initial_setup`, `read_document`, `write_document`, `compile_source`, `read_pdf`, `default_document_folder`, `list_system_fonts`. Long-running commands are `async` and wrap blocking work in `spawn_blocking`; shared state (`CompileLock`, `FontCache`) is Tauri managed state.
- Frontend flow: `App.tsx` gates checking → `SetupScreen.tsx` → `Writer.tsx`. The Writer owns document state and renders `Ribbon.tsx` (tabs File/Home/Insert/Layout/View; pop-ups in `src/ribbon/`), `Editor.tsx` (CodeMirror 6, LaTeX via legacy `stex`) and `PdfView.tsx` (pdf.js). Backend calls are wrapped in `compile.ts` and `documents.ts`; Writer tests mock those plus Editor and PdfView.
- All ribbon actions are text edits computed by pure functions in `src/latex/` (`format`, `equations`, `tables`, `settings`, `fonts`) and applied through `EditorHandle` (`apply` / `replaceAll`), so each is exactly one undo step. Put new LaTeX-generating logic there, with unit tests.
- Document settings (font, size, paper, orientation, margins) live in the `.tex` file: one marked block after `\documentclass` plus the class size option, and `% !TEX program = xelatex` on line 1 for installed (system) fonts. Format: `specs/002-word-style-editor/contracts/settings-block.md`. Lexy must never edit other preamble lines.
- Compiling never touches the user's file: `compile_source(source, documentPath)` writes a snapshot to `%LOCALAPPDATA%\Lexy\Build\<hash(path)|untitled>\<stem>.tex` and runs latexmk there (engine from the `% !TEX program` marker; `TEXINPUTS=<doc folder>;` so `\input` beside a saved document resolves; MiKTeX/Perl folders on PATH; hidden console; 180 s tree-kill timeout; one compile at a time via `CompileLock`). `read_pdf` only serves PDFs under the build root.
- Live preview: `livePreview.ts` is a pure debounce/coalesce scheduler (1 s pause, max one running + one queued, newest text wins). Explicit Compile/F5 saves first, then compiles; only explicit failures open the log drawer.
- `PdfView` renders all pages offscreen with pdf.js and swaps them in, keeping the scroll position. pdf.js draws via `requestAnimationFrame`, so rendering pauses while the window is hidden (and in a hidden browser preview).
- New documents save to `<Documents>\Lexy` (`default_document_folder`, via Tauri's `document_dir()`, created on demand; falls back to home with a notice). A file chosen directly in that folder is moved into its own project folder by `prepare_save_path` (`Lexy\Name\Name.tex`, `Name (2)` if taken); the suggested name comes from `\title` (`suggestFileName`).
- The PDF stays in the build folder while editing. On window close the Writer exports it beside the saved `.tex` (`export_pdf`), recompiling the saved text first if the last PDF came from other text or another path; a failed export keeps the window open once with a notice.
- TS types (`ToolProbe`, `EnvironmentStatus`, `CompileResult`, `DefaultFolder`) mirror the Rust serde structs (camelCase) by hand — change both sides together. Rust tests assert the JSON shape.
- First-run install lives in `src-tauri/src/setup.rs` (testable without Tauri: progress goes through a `Reporter` callback). Strawberry Perl comes from the portable ZIP (pinned SHA-256, no admin) into `%LOCALAPPDATA%\Lexy\Setup\StrawberryPerl`; downloads/unzip are native Rust (`ureq` native-tls, `zip`) with byte progress; MiKTeX output is streamed. Events: `setup-progress` `{ step, state: running|done|skipped|error, label, detail, progress, bytesDone, bytesTotal }`; step ids must match `SETUP_STEPS` in `SetupScreen.tsx`. Everything is logged to `Setup\setup.log` (`read_setup_log`). Never go back to silent MSIs: per-machine installs need admin and fail with 1603.
- Writer shortcuts are a capture-phase `window` listener so they win over CodeMirror bindings (Ctrl+L, Ctrl+I). The unsaved-changes close guard uses `onCloseRequested`, which needs `core:window:allow-destroy` in capabilities.
- Theming: all colors are CSS variables on `:root` in `App.css` with a `prefers-color-scheme: dark` override; CodeMirror's theme and highlight style read the same variables. The ribbon collapses labels with a `@container ribbon` query.
- Tool detection order: app-managed install under `%LOCALAPPDATA%\Lexy\Setup`, then common per-user/system locations, then `PATH`. Beware: Git Bash puts its own `perl` on PATH, so tests run from Git Bash can find Perl when the app (launched normally) can't. MiKTeX is installed per-user with `--modify-path=no`, so compiles must use resolved binary paths, never assume tools are on `PATH`.
- External work (downloads via `Invoke-WebRequest`, zip extraction, `msiexec`, `miktexsetup_standalone`) goes through `run_command`, which shells out with captured stdout/stderr. PowerShell arguments must go through `powershell_escape*`.
- Downloads call `verify_sha256`, but the pinned hashes (`MIKTEX_SETUP_SHA256`, `STRAWBERRY_PERL_MSI_SHA256`) are still `None`; pinning them is a pre-release requirement.

## Engineering rules (from PLAN.md)

- Typed serializable request/response structs for commands; structured errors where the UI branches on them (current code still returns `Result<_, String>`).
- No `.unwrap()` on recoverable paths in Rust.
- Shared services go in managed Tauri state, not globals.
- Treat external process output as untrusted: capture logs, time out jobs, validate paths.
- Keep capabilities in `src-tauri/capabilities/default.json` explicit and minimal.
- Never silently download/execute at startup; installs need visible progress and version-pinned, hash-verified sources.

`.agents/skills/rust-skills/` is a vendored third-party Rust style skill (tracked in `skills-lock.json`); it is reference material, not project code.
