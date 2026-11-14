# Research: Seamless Bangla and Multilingual Documents

All findings below were tested on the dev machine on 2026-11-13/14 (MiKTeX 26.5 per-user, latexmk 4.88, Lexy's portable Strawberry Perl, LaTeXbangla 2.1 from MiKTeX), unless marked as from docs. The test scripts lived in the session scratchpad and are not part of the repo. Context7 was used for CodeMirror (`/codemirror/view`).

## R1. Engine choice (FR-001…FR-004, the reported failure)

- **Finding**: `latexbangla.sty` line 34 calls `\RequireTUTeX`, which stops pdfLaTeX with "LuaTeX or XeTeX is required". Lexy's `engine_from_marker` only reads a `% !TEX program` line and defaults to pdfLaTeX.
- **Decision**: Add `choose_engine(text)` in Rust: marker first (unchanged); else scan the preamble (text before `\begin{document}`, comments stripped) for `\usepackage`/`\RequirePackage`/`\documentclass` names. If any name is in the Unicode-engine list, use XeLaTeX; else pdfLaTeX. The list is a `const` slice: `latexbangla, fontspec, polyglossia, unicode-math, xeCJK, luatexja, bidi, xltxtra, xunicode, mathspec` and classes `bookbangla, ctexart, ctexbook, ctexrep` (the ctex classes work on XeLaTeX). `babel` is not in the list: it also runs on pdfLaTeX. Preamble files pulled in with `\input`/`\include` before `\begin{document}` are scanned one level deep (from the unsaved buffers or disk), which covers the common "preamble.tex" pattern.
- **Rationale**: Smallest change at the one place the engine is decided; deterministic and unit-testable; explicit markers keep working (SC-005: no pdfLaTeX document changes engine, because none of these packages can run on pdfLaTeX anyway).
- **Alternatives**: Retry with XeLaTeX after a pdfLaTeX failure (doubles compile time, and the error text is engine-specific). Always XeLaTeX (slower, and changes output of existing pdfLaTeX documents: violates SC-005).

## R2. Fonts installed in Windows (FR-006)

- **Finding**: MiKTeX's fontconfig (`%APPDATA%\MiKTeX\fontconfig\config\localfonts.conf`) already lists `%LOCALAPPDATA%\Microsoft\Windows\Fonts` (per-user installs), `C:\Windows\Fonts` and MiKTeX's own OpenType folder. XeLaTeX found Kalpurush (system-wide) by family name.
- **Decision**: Nothing to build for XeLaTeX. LuaLaTeX (only when the document asks for it) uses luaotfload's own font database; Lexy does not manage it (documented limit).
- **Risk**: fontconfig caches font folders; a font installed while Lexy runs is picked up on the next compile because fontconfig re-checks folder timestamps (docs). If not, the error message from R5 tells the user the name.

## R3. Font files inside the project (FR-007)

- **Finding**: Lexy compiles in `%LOCALAPPDATA%\Lexy\Build\<hash>`. `\setbanglamainfont{MyBangla.ttf}[Path=fonts/]` with the font only in `<project>\fonts\` (not installed) **fails** without help: XeTeX asks MiKTeX for a TFM, METAFONT runs and fails with "Transform components aren't all known". With `TTFONTS` and `OPENTYPEFONTS` set to `<overlay>;<project root>;` it **succeeds**: fontspec's `[fonts/MyBangla.ttf]` lookup is resolved against those search paths. Plain `\setbanglamainfont{MyBangla.ttf}` with the font at the project root resolves the same way.
- **Decision**: Set `TTFONTS` and `OPENTYPEFONTS` to the same value as `TEXINPUTS` (R4) for every compile.
- **Alternatives**: Copying font files into the build folder (duplicates large files, stale copies). Running latexmk with the project as working directory and `-outdir` to the build folder (tested: also works, and the overlay still wins), but it puts relative `\write`/`\openout` files into the user's folder: rejected because "compiling never touches the user's files".

## R4. Non-Latin names: latexmk is the weak link (FR-014)

- **Findings**:
  - `pdflatex` and `xelatex` handle Bangla file names, folder names and Bangla paths in `TEXINPUTS` correctly.
  - `latexmk` (a Perl script) breaks Bangla text in two places: a Bangla **file name on its command line** ("Wildcards in file names didn't match any files", exit 10), and a Bangla path inside **environment variables it passes on** (`TEXINPUTS` with a Bangla project root: file not found, exit 12; XeLaTeX printed `???????/??????.tex`).
  - Bangla names **inside the document** (`\input{অধ্যায়/ভূমিকা}`) work through latexmk, as long as the search path itself is ASCII.
  - An ASCII-named **directory junction** in the build folder pointing at a Bangla-named project made `latexmk -xelatex` find both ASCII- and Bangla-named files. Removing the junction with `rmdir` leaves the project untouched.
- **Decision**:
  1. The build snapshot's file name is the main document's stem when it is plain ASCII (keeps `\jobname`), else `document`. The exported PDF keeps the real name, because `export_pdf` already names it after the main document's path.
  2. When the project root path is not plain ASCII, the build folder gets a junction `<build>\.lexy-root` → project root, and all search paths use the junction. ASCII roots are used directly (no junction, nothing new on most machines).
  3. If `%LOCALAPPDATA%` itself is not ASCII (non-Latin Windows user name), the build root falls back to `%ProgramData%\Lexy\Build\<user-hash>`. *shortcut: ProgramData is shared by all local users; the hash keeps folders apart. Upgrade to a per-user ASCII location if this matters.*
- **Safety**: Rust's `fs::remove_dir_all` removes a junction without following it (std docs for Windows; verify with a test before any cleanup code touches the build folder). Lexy never deletes the build folder today; the overlay cleanup (`remove_dir_all(<build>\.lexy-overlay)`) must never be pointed at the junction.
- **Alternatives**: Windows 8.3 short names (disabled on many non-system drives). Replacing latexmk with Lexy's own rerun loop (large; latexmk handles biber/bibtex/makeindex dependencies). MiKTeX `-include-directory=` arguments (still pass through Perl, same corruption).

## R5. Error summaries for fonts (FR-008)

- **Finding**: For a missing font, the first `!` line is METAFONT noise ("Transform components aren't all known"). The real cause is fontspec's `The font "X" cannot be found` (XeTeX) — it may be split across log lines with a `(fontspec)` prefix.
- **Decision**: Before `first_latex_error`, look for `The font "<name>" cannot be found` in the TeX log (lines joined, `(fontspec)` prefixes removed). If found, the summary is `Font "<name>" not found`. Unit-tested with the captured log text.

## R6. Missing packages (FR-015, SC-006)

- **Finding**: MiKTeX engines accept `-enable-installer` per run (`xelatex --help`). The dev machine has `[MPM]AutoInstall=1`, but a fresh install may keep MiKTeX's default ("ask"), which shows a dialog the hidden compile can't answer until the 180 s timeout.
- **Decision**: Pass the flag through latexmk for each engine: `-pdflatex="pdflatex -enable-installer %O %S"`, and the same for xelatex and lualatex. No change to the user's MiKTeX settings. With the installer enabled, a package that still can't be loaded shows up as ``LaTeX Error: File `x.sty' not found.`` (or `.cls`), because the install failed (offline) or the package doesn't exist. That line is the reliable signal, so the summary becomes `Package "x" could not be found or installed (offline?)`. (Implementation note, 2026-11-14: replaces the first idea of matching MiKTeX's own install message, whose exact text was not seen in a real log.)
- **Alternatives**: `initexmf --set-config-value=[MPM]AutoInstall=1` during setup (changes the user's global MiKTeX config; acceptable later, but the per-run flag needs no consent and also covers MiKTeX installs Lexy didn't make).

## R7. Biber for Bangla bibliographies (FR-016)

- **Decision**: latexmk already runs biber/bibtex when the `.bcf`/`.aux` asks for it; `BIBINPUTS` already points at the project, and gets the same junction treatment as R4. Biber is part of MiKTeX's basic set; with `-enable-installer` missing pieces install on first use. Verified by the e2e test in the plan (biblatex + `backend=biber`), skipped when tools are absent.

## R8. Editor: scripts, clusters, RTL, input methods (FR-010…FR-013)

- **Findings (Context7 `/codemirror/view`)**: cursor motion (`moveByChar`) works on grapheme clusters in visual (bidi-aware) order; `EditorView.perLineTextDirection` (default `false`) makes each line take its own direction. CodeMirror handles IME composition (`view.composing`).
- **Corrected during implementation (2026-11-14)**, both found by tests:
  - CodeMirror's grapheme rules predate Unicode 15.1's conjunct rule, so it splits "ক্ষ" into "ক্" + "ষ". Its arrow keys stop inside the conjunct, and its Backspace at that point removes only the virama, leaving the broken "কষ". The browser's `Intl.Segmenter` (ICU 78 in Node; WebView2 checked: "ক্ষেত্র" → 4+3) does know the conjunct rule.
  - `perLineTextDirection` only *reads* each line's CSS direction; it does not set it. Without `dir="auto"` on the line element, an Arabic line stayed LTR in the browser pane.
- **Decision**:
  - Enable `EditorView.perLineTextDirection.of(true)`, plus a view plugin that puts `dir="auto"` on every visible line.
  - Add `src/indicKeys.ts`, a high-precedence keymap that acts only next to Indic letters (U+0900–U+0DFF) on left-to-right lines:
    - Left and Right step by `Intl.Segmenter` grapheme boundaries (a whole conjunct, like Windows text boxes).
    - Backspace removes one code point, like Windows: ক্ষ → ক্, আমি → আম.
  - Everything else keeps CodeMirror's commands, including right-to-left lines and emoji.
  - Extend `--font-mono` with script fallbacks that ship with Windows: `"Nirmala UI"` (Bangla, Devanagari and other Indic scripts), `"Segoe UI"` (Arabic, Hebrew), `"Microsoft YaHei"`, `"Yu Gothic"`, `"Malgun Gothic"` (CJK). Browser check: no vertical clipping at line height 1.55.
- **Alternatives**: Keep CodeMirror's behaviour (cursor stops inside conjuncts; Backspace there breaks text: fails FR-011). Patch CodeMirror's cluster tables (fork maintenance).

## R9. Lexy's font settings with LaTeXbangla (FR-009)

- **Finding**: Lexy's settings block for installed fonts writes `\usepackage{fontspec}` and `\setmainfont{…}`. LaTeXbangla loads fontspec itself and expects `\setmainfont` for the English font (its README does exactly this). Loading fontspec twice is harmless.
- **Decision**: No change to the settings block format. Add a test that applying a font to a LaTeXbangla document leaves `\usepackage{latexbangla}` and `\setbanglamainfont…` lines unchanged and compiles (e2e, skipped without tools).
