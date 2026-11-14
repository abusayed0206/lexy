# Lexy

**A calm, Word-like LaTeX writer for Windows.** Lexy installs the TeX tools it needs, compiles while you type, and keeps your projects as plain folders that also work in TeXstudio, VS Code or Overleaf.

> Status: early development (v0.1.0). There are no release builds yet; run it from source (below).

## Highlights

- **Ribbon instead of commands.** File, Home, Insert, Layout, View and Git tabs. Bold, headings, lists, footnotes, tables (grid picker), equations (palette with live math preview), fonts, paper, margins and orientation. Every ribbon action is one undo step, and page settings live in one marked block in your `.tex`.
- **Live preview.** Compiles about a second after you stop typing, in the background. The PDF updates without losing your zoom or scroll position, and if a compile fails the last good PDF stays visible.
- **Jump between PDF and source.** Double-click the PDF to go to the line that produced it, even in a chapter file. Press **Ctrl+J** to see the cursor's line in the PDF.
- **Readable errors.** Errors and warnings appear inline in the editor and in a Problems list. Click one to open the file at that line.
- **Projects are folders.** A file sidebar, a main document per project, multi-file documents (`\input`, `\include`, images, `.bib`), drag-and-drop from Explorer, and deletes that go to the Recycle Bin. Lexy never writes its own state into your project.
- **Bangla and other scripts.** Bangla text compiles even without any font setup: Lexy picks XeLaTeX and a Bangla-capable font automatically, with correct conjuncts. One click adds **BCC Purno** to the project so it compiles anywhere. The font menu lists the whole free **[kriti.app](https://kriti.app)** Bangla catalog (each font is copied into the project). The editor shows Bangla in a bundled font, with Windows-like cursor movement over conjuncts, and right-to-left lines read correctly.
- **Version history with Git.** Start history, commit, see line-by-line changes, browse and restore old versions, publish to GitHub, push, pull and resolve conflicts. Lexy uses your Git for Windows; sign-in goes through Git's own credential manager and never through Lexy.
- **Zero-setup TeX.** On first run Lexy installs MiKTeX (per user, no admin) and a portable Strawberry Perl for `latexmk`, with visible progress. Missing LaTeX packages are installed on the fly during a compile.
- **Light and dark themes**, keyboard shortcuts for everything, and a layout that works at 800×600.

## Keyboard shortcuts

| Action | Keys |
|---|---|
| Compile now | F5 |
| Save all / Save as | Ctrl+S / Ctrl+Shift+S |
| New file / Open folder | Ctrl+N / Ctrl+O |
| Bold / Italic / Underline | Ctrl+B / Ctrl+I / Ctrl+U |
| Show the cursor's line in the PDF | Ctrl+J |
| PDF zoom in / out / fit (preview focused) | Ctrl+= / Ctrl+- / Ctrl+0, or Ctrl+wheel |
| Show logs | Ctrl+L |
| Files sidebar | Ctrl+Shift+E |
| Git panel / commit message | Ctrl+Shift+G / Ctrl+Shift+K (Ctrl+Enter commits) |

## Run from source

Requirements: Windows 10 or 11, [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) (stable, MSVC toolchain) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (WebView2 ships with Windows 11). For the Git features you also need [Git for Windows](https://git-scm.com/download/win); [GitHub CLI](https://cli.github.com) is only needed for "Publish to GitHub".

```powershell
npm install
npm run tauri dev
```

The first start runs Lexy's setup screen, which installs MiKTeX and Strawberry Perl if they are missing.

Build an installer locally:

```powershell
npm run tauri build
```

## Tests

```powershell
npm test                       # frontend (Vitest)
npm run build                  # type check + production build
cd src-tauri; cargo test       # backend (Rust)
```

Some Rust tests run real compiles with MiKTeX, `latexmk` and Perl, and skip themselves ("skipping") on machines without them. The font tests download from kriti.app; set `LEXY_OFFLINE=1` to skip those without a network.

## How it works

Lexy is a [Tauri 2](https://tauri.app) app: a React 19 + TypeScript front end (CodeMirror 6 editor, pdf.js preview) and a Rust back end that owns everything that touches files or runs programs.

```mermaid
flowchart TB
  subgraph UI["Front end · React (presentation only)"]
    direction LR
    Ribbon["Ribbon<br/>LaTeX edits from src/latex"]
    Editor["Editor<br/>CodeMirror 6 · problem markers"]
    Preview["PDF preview<br/>pdf.js · zoom kept"]
    GitPanel["Git panel"]
  end

  subgraph Rust["Back end · Rust (owns files and processes)"]
    direction LR
    Gate["project.rs<br/>path gate"]
    Compile["compile_project<br/>engine · snapshot · overlay"]
    Sync["sync.rs<br/>SyncTeX · log → problems"]
    Fonts["bangla.rs · kriti.rs<br/>Bangla fonts"]
    Setup["setup.rs<br/>first-run install"]
    GitRs["git.rs"]
  end

  subgraph Ext["Programs and services"]
    direction LR
    TeX["latexmk · MiKTeX<br/>pdfLaTeX / XeLaTeX · synctex"]
    Net["kriti.app · MiKTeX / Perl<br/>downloads"]
    GitExe["Git for Windows<br/>GitHub CLI"]
  end

  subgraph Disk["On disk"]
    direction LR
    Project[("Your project folder<br/>.tex · chapters · images · .bib · fonts/")]
    Build[("Build folder in %LOCALAPPDATA%\Lexy<br/>snapshot · overlay · last good PDF")]
  end

  Ribbon -->|"one undo step"| Editor
  Editor -->|"save"| Gate
  Editor -->|"1 s after typing: text + unsaved files"| Compile
  Editor -->|"Ctrl+J: file, line"| Sync
  Preview -->|"double-click: page, x, y"| Sync
  GitPanel -->|"git_* commands"| GitRs

  Gate -->|"read / write (inside the project only)"| Project
  Compile -->|"snapshot + overlay"| Build
  Compile -->|"runs latexmk"| TeX
  Sync -->|"synctex edit / view"| TeX
  Fonts -->|"verified download"| Net
  Setup -->|"pinned SHA-256"| Net
  Fonts -->|"font files + notice"| Project
  GitRs -->|"git / gh"| GitExe

  TeX -->|"reads sources"| Project
  TeX -->|"PDF · SyncTeX · log"| Build
  GitExe -->|"history"| Project

  Compile -.->|"result: PDF path, problems"| Preview
  Build -.->|"read_pdf"| Preview
  Project -.->|"file watcher"| Editor
```

*Solid arrows are requests and writes; dotted arrows bring results back to the screen. Every arrow out of the front end is a typed `invoke` command, so React never touches the disk or starts a process. Compiles read your project but write only into the build folder, where the last good PDF and its SyncTeX data are kept; a failed compile never overwrites them.*

- **Compiling never touches your files.** The main document is written to a snapshot in `%LOCALAPPDATA%\Lexy\Build\…`, unsaved open files go into an overlay folder that TeX searches first, and everything else (chapters, images, `.bib`, fonts) is read straight from the project. `latexmk` runs with pdfLaTeX, or XeLaTeX when the document needs it (a `% !TEX program` line, packages like `fontspec`/`polyglossia`/`latexbangla`, or Bangla text). Every compile also writes SyncTeX data for the PDF ↔ source jumps.
- **Paths are checked in one place.** Every file command takes a project-relative path and goes through one gate that refuses `..`, other drives, reserved names and links that lead out of the project.
- **Downloads are verified.** Setup tools and BCC Purno are downloaded from fixed versions with pinned SHA-256 hashes. kriti.app catalog fonts come only from `https://kriti.app/fonts/…` and must be real font files.

More detail lives in the docs:

- [`docs/PLAN.md`](docs/PLAN.md): architecture, milestones and engineering rules
- [`docs/DESIGN.md`](docs/DESIGN.md): UI rules
- [`docs/SETUP.md`](docs/SETUP.md): how the first-run install works
- [`docs/TRACKER.md`](docs/TRACKER.md): feature status, decisions and test runs
- [`specs/`](specs/): one folder per feature (spec, plan, research, tasks)
- [`CLAUDE.md`](CLAUDE.md): a compact architecture guide for contributors and coding agents

## Contributing

Ideas go into the "Manual Feature Intake" table in `docs/TRACKER.md` first. Each feature gets a spec under `specs/`, and `docs/TRACKER.md` is updated in the same change that implements it. Run the three test commands above before sending a change.

## Fonts and third-party notices

- **BCC Purno** (Bangladesh Computer Council, EBLICT project) is bundled for showing Bangla in the editor (`src/assets/fonts/`) and is copied into projects when you choose it. Its notice file names the source; the license is the Bangladesh Computer Council's.
- Fonts from the **kriti.app** catalog are downloaded only when you pick one, and each project gets a notice file with the font's designer, license and source link.
- MiKTeX, Strawberry Perl, Git and GitHub CLI are installed or used as separate programs under their own licenses.

## License

Lexy is free software under the **GNU General Public License v3.0 or later** ([`LICENSE`](LICENSE)), copyright © 2026 MD. ABU SAYED.

In short: you may use, study, change and share Lexy. If you distribute Lexy or a modified version, you must keep the copyright and license notices (credit the original project), release your complete source code under the same license, and state what you changed. See [`LICENSE`](LICENSE) for the exact terms.

Third-party fonts and tools keep their own licenses (see "Fonts and third-party notices" above); the bundled BCC Purno font is not covered by the GPL.
