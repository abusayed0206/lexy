# Lexy Product And Engineering Plan

Last updated: 2026-06-10

Lexy is a Windows-first LaTeX writer built with Tauri 2, React, TypeScript, and Rust. The product goal is maximum minimalism: a quiet writing surface, reliable PDF compilation, and a smooth first-run setup that hides MiKTeX and Strawberry Perl complexity without hiding important failures.

Before implementing any feature, read this file, `docs/DESIGN.md`, and `docs/TRACKER.md`. Update the tracker in the same change that implements or changes a feature.

## Current Baseline

The repository is currently a fresh Tauri 2 + React + TypeScript scaffold:

- Frontend: React 19, TypeScript, Vite.
- Backend: Rust crate in `src-tauri`.
- Tauri config: `bundle.active = true`, `targets = "all"`, default window, default template metadata.
- Existing app behavior: default Tauri greeting demo.
- Existing plan: `PLAN_draft.md`, kept as historical input. This plan supersedes it.

## Product Principles

1. Minimal first screen: no landing page, no tutorial wall, no decorative chrome.
2. One primary job: write LaTeX and see the compiled PDF.
3. Installation must feel boring: clear progress, no surprise admin prompts unless required, no unexplained terminal windows.
4. Failures must be understandable: dependency, compile, file, and permission errors should be distinct.
5. No hidden data loss: all document writes are explicit or autosaved with visible state.
6. Windows is the release target until the tracker says otherwise.

## Architecture

Lexy should keep a small boundary between the UI and system operations.

```text
React UI
  | invokes typed commands
Rust/Tauri command layer
  | validates paths, queues jobs, emits status events
Workspace service
  | reads/writes .tex project files
Compiler service
  | runs latexmk or MiKTeX tools with captured logs
Dependency service
  | detects, installs, and verifies MiKTeX + Strawberry Perl
Windows system
```

The React side owns presentation state. The Rust side owns filesystem access, process execution, installation checks, and compile job lifecycle.

## Dependency Strategy

Use MiKTeX and Strawberry Perl under the hood, but do not assume they are globally available on `PATH`.

Preferred order:

1. Detect a known-good bundled or app-managed installation.
2. Detect user/system installations and validate required binaries.
3. Offer app-managed install with visible progress and clear consent.
4. Show manual fix instructions only when automated setup fails.

Do not silently download and execute arbitrary URLs at startup. Package known installer assets through Tauri bundle resources where licensing and file size allow it, or download version-pinned installers with hash verification and user-visible progress.

Current Tauri 2 docs confirm:

- Windows installers are produced by `npm run tauri build`.
- Installer resources can be included with `bundle.resources` and accessed under the installed app resources directory.
- Sidecar binaries use `bundle.externalBin`.
- External command execution through the shell plugin requires explicit capabilities.

## Installation Flow

Target flow for the end user:

1. User runs the Lexy Windows installer.
2. Installer installs Lexy and required WebView2 handling via Tauri bundle config.
3. First launch opens a setup screen only if LaTeX dependencies are missing or invalid.
4. Setup verifies MiKTeX, Perl, `latexmk`, and basic package installation behavior.
5. If missing, setup installs dependencies through an app-managed path with progress.
6. After verification, Lexy opens the editor with a starter document.
7. Future launches skip setup unless verification fails.

Implementation notes:

- Keep installer operations idempotent.
- Store dependency status in app data, but always revalidate executable paths before compiling.
- Capture installer logs to app log files.
- Avoid requiring admin when a per-user install works.
- If an admin prompt is unavoidable, explain why before triggering it.

## MVP Scope

The MVP is not a full IDE. It is a focused writing app.

Required MVP:

- Minimal editor for a single `.tex` document.
- PDF preview.
- Manual compile command.
- Debounced auto compile option.
- Compile status and log panel.
- MiKTeX and Strawberry Perl detection.
- First-run dependency setup flow.
- Open/save `.tex` files.
- Buildable Windows installer.

Explicitly out of MVP:

- Cloud sync.
- Collaboration.
- Template marketplace.
- Full TeX package manager UI.
- Git integration.
- Multi-platform release.

## Milestones

### M0: Project Grounding

Goal: replace scaffold ambiguity with clear project identity.

Exit criteria:

- README points contributors to plan, design, and tracker.
- App metadata uses Lexy identity.
- Default Tauri demo removed.
- Tracker is the source of truth.

### M1: Minimal Writer Shell

Goal: make the app look and behave like a LaTeX writer even before real compilation.

Exit criteria:

- Editor, preview, status bar, and log panel exist.
- Starter document is loaded.
- UI has minimal Windows-friendly layout.
- No marketing page or demo content remains.

### M2: Workspace And File IO

Goal: safely handle local documents.

Exit criteria:

- User can create, open, save, and save as `.tex`.
- App tracks dirty state.
- File paths are validated in Rust.
- Recent file storage exists.

### M3: Compiler Pipeline

Goal: compile reliably and surface errors.

Exit criteria:

- Rust compile command runs `latexmk` in an isolated workspace.
- Compile jobs are queued or cancelled to avoid overlapping writes.
- stdout, stderr, exit code, and generated PDF path are returned.
- PDF preview refreshes after successful compile.

### M4: Dependency Setup

Goal: make MiKTeX and Strawberry Perl setup smooth.

Exit criteria:

- App detects MiKTeX, Perl, and `latexmk`.
- App-managed setup has progress and failure recovery.
- Installer/download sources are version-pinned and hash-verified.
- Setup logs are available from the UI.

### M5: Windows Installer

Goal: produce a usable installer for non-developer machines.

Exit criteria:

- `npm run tauri build` produces the selected Windows installer target.
- Installer path handles WebView2 requirements.
- Fresh Windows VM smoke test passes.
- Uninstall leaves user documents untouched.

### M6: Polish And Hardening

Goal: reduce sharp edges.

Exit criteria:

- App handles missing files, invalid paths, compile failures, and dependency failures.
- Keyboard shortcuts are implemented.
- Accessibility and text overflow checks pass.
- Release checklist is documented.

## Engineering Rules

- Keep Rust command APIs typed with serializable request/response structs.
- Return structured errors instead of raw strings where errors affect UI decisions.
- Do not use `.unwrap()` in production Rust paths for recoverable errors.
- Avoid global mutable state; use managed Tauri state for shared services.
- Treat external process execution as untrusted output: capture logs, time out jobs, and validate paths.
- Keep frontend state local until shared state is proven necessary.
- Prefer explicit capabilities in `src-tauri/capabilities/default.json`.

## Verification Matrix

Every completed milestone should identify the verification level used:

- Local dev: `npm run tauri dev`.
- Frontend build: `npm run build`.
- Rust build/check: `cargo check` from `src-tauri`.
- Tauri bundle: `npm run tauri build`.
- Fresh machine: clean Windows VM with no MiKTeX or Strawberry Perl.
- Upgrade test: install new Lexy over old Lexy.
- Uninstall test: remove Lexy and confirm user files remain.

## Open Decisions

Track these in `docs/TRACKER.md` until resolved:

- Installer target: NSIS, MSI, or both.
- Whether MiKTeX and Strawberry Perl installers are bundled resources or downloaded on demand.
- Exact MiKTeX install mode: per-user managed install is preferred.
- Whether PDF preview uses native WebView asset URLs, a bundled PDF viewer, or an internal renderer.
- Editor engine: plain textarea for MVP, CodeMirror/Monaco only if needed.
