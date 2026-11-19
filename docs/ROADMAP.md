# Lexy roadmap and handover notes

Last updated: 2026-11-19. The original author has stopped working on Lexy (see the README). This page is for whoever picks it up: what works, what is unfinished, what blocks a real release, and where the code could be faster or simpler.

Status per feature lives in [`TRACKER.md`](TRACKER.md); every feature has a folder under [`specs/`](../specs/) with its spec, plan, research and tasks.

## Where things stand

- Features **001–008 are built**, and all spec tasks are checked off.
- **Automated tests:** 175 Rust tests (including real latexmk, SyncTeX and Git end-to-end runs) and 658 Vitest tests pass; the build passes.
- **Never checked by hand:** most features were never walked by hand in the **native Tauri window** or on a **fresh Windows machine**. Gates were checked with automated tests and the browser preview with a stubbed backend. That is why many tracker rows say "In Progress": the code is there, the manual check is not.
- **Alpha:** an unsigned alpha build (`v0.1.0-alpha.1`) is published on GitHub Releases for enthusiasts.

## 1. Verification still owed (do these first)

Walk these in `npm run tauri dev` or an installed build, and record the results in the TRACKER Verification Log.

| What | Where it is described |
| --- | --- |
| Writer shell at 800x600 and 100/125/150 % display scaling | `specs/001-writer-shell` T024 |
| Every ribbon scenario in the native window, dark mode, a OneDrive-redirected Documents folder | `specs/002-word-style-editor` T055 |
| PDF ↔ source jumps, problems, zoom (quickstarts A–C), jump timing on 50 pages | `specs/003-pdf-source-sync` |
| Explorer drag-drop, two windows (read-only lock), outside changes, close prompt | `specs/004-project-workspace` |
| Typing with Avro / the Windows Bangla keyboard; the editor's Bangla font | `specs/005-bangla-multilingual` |
| A real private GitHub publish, push/pull/conflict | `specs/006-git-integration` quickstarts A–C |
| Writing toolkit quickstarts A–G and W: live LanguageTool, live doi.org, the real 43 MB Pandoc download and conversion, a Windows contrast theme | `specs/007-writing-toolkit/quickstart.md` |
| Kill `lexy.exe` and recover unsaved text; Stop on a hung compile (2 s target); the Engine menu; Ctrl+F in a real PDF (SC-007 timing) | `specs/008-safety-control-polish/quickstart.md` |
| **Fresh Windows VM** with no MiKTeX or Perl: setup, first compile, missing-package install, uninstall | TRACKER F-022, F-023, F-025, F-035 |

## 2. Release blockers (before calling anything 1.0)

- **Code signing (not tracked as a feature yet).** The installers are unsigned, so Windows SmartScreen shows "unknown publisher". This needs a certificate (or Azure Trusted Signing) and `bundle.windows.signCommand` / `certificateThumbprint` in `tauri.conf.json`.
- **Pin the MiKTeX setup hash** (F-024). MiKTeX publishes `miktexsetup` only at a rolling "latest" URL (`src-tauri/src/setup.rs`), so it is downloaded without a pinned SHA-256. Mirror a fixed version, or verify its signature.
- **Installer decisions:**
  - NSIS vs MSI vs both (F-028); today `targets: "all"` builds both.
  - Bundle MiKTeX/Perl or keep downloading on first run (F-029).
  - WebView2 install mode (F-030).
- **Update strategy** (F-031): `tauri-plugin-updater` with a signed update feed. It needs signing keys and a place to host `latest.json`.
- **Release checklist** (F-036): build → install → setup → compile → export → uninstall, on a clean VM.

## 3. Feature backlog

Ideas already triaged in TRACKER's "Manual Feature Intake":

- **Bangla spell-check dictionary.** Only `en_US` is bundled; pick a Hunspell `bn_BD` dictionary with a compatible license.
- **MiKTeX package updates.** Lexy installs MiKTeX once and never updates it. Add an update check or button. Lexy must not change MiKTeX's own configuration silently.
- **In-app updates** (see F-031).
- **Declined by the author:** selecting and copying text in the PDF preview, and Zotero/Mendeley integration. Revisit if users ask.

Smaller ideas noticed while building:

- A "Recompile from scratch" command (delete the build folder for this document).
- Per-project spelling language, and more templates (thesis, Bangla article).
- Show recovery copies in File → Earlier versions too, not only on reopen.
- Find in PDF: a match-case option, and searching shaped Bangla text, whose PDF text extraction is often lossy.

## 4. Optimizations and tech debt

Each item is marked in the code with a `shortcut:` comment unless noted.

| Area | Today | Better |
| --- | --- | --- |
| PDF preview (`src/PdfView.tsx`) | Renders **every page** eagerly on each update | Render visible pages lazily (IntersectionObserver) and keep canvases for unchanged pages; this matters past ~50 pages |
| Project texts (`src/Writer.tsx`) | Reloads every text file after any file-tree change | Call `project_texts(paths)` for the changed paths only |
| Build folder for non-ASCII user names (`lib.rs`) | Falls back to `%ProgramData%\Lexy\Build\<hash>` (shared by all users) | A per-user ASCII location |
| Recycle Bin errors (`project.rs`) | Any failure is reported as "no Recycle Bin" | Tell real errors apart |
| Find in PDF (`src/pdfView/find.ts`) | Highlight boxes split an item's width proportionally | Measure glyph advances, or use pdf.js `TextLayer` geometry |
| `src/Writer.tsx` (≈2,500 lines) and `src-tauri/src/lib.rs` (≈2,450 lines) | One big component / module | Split into hooks (compile, recovery, project files, notes) and Rust modules (compile, engine, process) |
| Error types | Many commands still return `Result<_, String>` | Typed errors where the UI branches (PLAN.md rule) |
| Frontend bundle | Vite warns about a large main chunk | Lazy-load the Git panel, the Settings page, CompareView and KaTeX |
| Flaky tests | Timing tests (word count, waitFor-based dialogs, stop timing) fail when `cargo test` and Vitest run at the same time | Run the suites one after another in CI, or raise those timeouts; the stop tests already measure from the cancel |
| CI | None | A GitHub Actions workflow on `windows-latest`: `npm test`, `npm run build`, `cargo test` (the e2e tests skip without MiKTeX) |

## 5. How to continue

1. Read `CLAUDE.md` (a compact architecture map), then `docs/PLAN.md`, `docs/DESIGN.md` and `docs/TRACKER.md`.
2. Pick an item above. New ideas go into TRACKER's intake table first. Bigger work gets a spec folder (the repo uses spec-kit: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`).
3. Keep the boundary rule: React only presents, and Rust owns files and processes. Never write into a user's project except through Save.
4. Update `docs/TRACKER.md` in the same change.
