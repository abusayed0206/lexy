# Feature Specification: Seamless Bangla and Multilingual Documents

**Feature Branch**: `005-bangla-multilingual`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "I want to add seamless bangla integration on the editor! You need to clone and check the codebase for this: https://github.com/Neehan/LaTeXbangla … i tried to run the example in my local lexy, its failed!" (log: `latexbangla.sty:34 \RequireTUTeX — LuaTeX or XeTeX is required`). Follow-up: "No need one click bangla documents now. but the bangla with custom font should work too! … i need bangla and other language too work seamlessly!"

**Why the example failed**: LaTeXbangla only runs on XeLaTeX or LuaLaTeX. Lexy chooses the engine only from a `% !TEX program = …` first line and otherwise uses pdfLaTeX, so any document that loads LaTeXbangla (or fontspec, polyglossia, and similar) without that line fails. The document was correct; Lexy picked the wrong engine.

**How LaTeXbangla works (from its source, v2.1, 2026-10-24)**: it loads fontspec (fonts) and polyglossia (language rules, numbering). Bangla text and English text are automatically set in their own fonts. On XeLaTeX this is done with character-class transitions between Bengali and Latin letters; on LuaLaTeX with a node callback and HarfBuzz shaping. Fonts are chosen with `\setbanglamainfont{Name}` (also sans and mono variants) by installed family name, or by file name with a `Path=` option. It supports Bangla and Assamese, localized numbering and bibliographies (biber/natbib). It needs a TeX distribution from 2024 or later. MiKTeX already ships it as a package.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Bangla document just compiles (Priority: P1)

A writer pastes the LaTeXbangla example (or writes their own document with `\usepackage{latexbangla}` and `\setbanglamainfont{Kalpurush}`) and presses F5. The PDF appears with correct Bangla shaping and mixed Bangla/English text, with no engine line to add and no extra setup.

**Why this priority**: This is the failure the user hit. Without it, nothing else in this feature matters.

**Independent Test**: Open a project whose main document is the LaTeXbangla `examples/bangla.tex` (no `% !TEX program` line), with Kalpurush installed, press F5, and get a PDF whose Bangla text shows correctly joined letters.

**Acceptance Scenarios**:

1. **Given** a document that loads LaTeXbangla and has no engine line, **When** it compiles (F5 or live preview), **Then** Lexy uses a Unicode-capable engine and the PDF is produced.
2. **Given** a document that loads any package that needs a Unicode engine (LaTeXbangla, fontspec, polyglossia, unicode-math, xeCJK, or a class built on them), **When** it compiles, **Then** Lexy picks the Unicode engine automatically.
3. **Given** a document whose first lines name an engine (`% !TEX program = lualatex`), **When** it compiles, **Then** that engine is used, overriding the automatic choice.
4. **Given** a plain English document with no such package, **When** it compiles, **Then** Lexy keeps using pdfLaTeX, as today.
5. **Given** the compile log shows which engine ran, **When** the user opens the log, **Then** the first line of the summary or the status tooltip names the engine (for example "XeLaTeX").

---

### User Story 2 - Any Bangla font the user has works (Priority: P1)

A writer wants their own Bangla font. Either it is installed in Windows (for themselves only, or for all users), or they keep the font file inside the project folder (for example `fonts/MyBangla.ttf`) so the project travels with its font. They name it with `\setbanglamainfont{…}` and it is used in the PDF.

**Why this priority**: The user asked explicitly that custom fonts work. Bangla typography depends on picking the right font, and many good Bangla fonts are installed per-user or shipped as loose files.

**Independent Test**: With Kalpurush installed only for the current user, compile `\setbanglamainfont{Kalpurush}`. Then remove it from Windows, put `kalpurush.ttf` in the project's `fonts` folder, use `\setbanglamainfont{kalpurush.ttf}[Path=fonts/]`, and compile again. Both PDFs use Kalpurush.

**Acceptance Scenarios**:

1. **Given** a font installed for all users, **When** the document names its family, **Then** the PDF uses it.
2. **Given** a font installed only for the current user, **When** the document names its family, **Then** the PDF uses it.
3. **Given** a font file inside the project folder, **When** the document names it by file name, with or without a project-relative `Path=`, **Then** the PDF uses it, even though Lexy compiles elsewhere.
4. **Given** a font name that cannot be found, **When** the compile fails, **Then** the status summary says in plain words that the font was not found and names it (for example "Font 'Kalpurus' not found"), not only the raw TeX error.
5. **Given** the Home font picker, **When** a document already uses LaTeXbangla, **Then** the picker still sets only the English font (`\setmainfont`), as LaTeXbangla documents expect, and never removes the Bangla font lines.

---

### User Story 3 - Writing Bangla and other scripts in the editor feels right (Priority: P2)

A writer types or pastes Bangla, and also Hindi, Arabic, Chinese or other scripts, in the editor. Letters join correctly, nothing is cut off at the top or bottom of the line, the cursor and selection move by whole characters (a conjunct or vowel sign is never split by arrow keys or Backspace leaving broken text), and right-to-left lines (Arabic, Hebrew, Urdu) read in the right direction.

**Why this priority**: Compiling is the core need; a clear editor makes daily writing comfortable but is not blocking.

**Independent Test**: Paste the LaTeXbangla example into the editor and check that Bangla words display joined, the line height shows full glyphs, and Left/Right/Backspace move across "ক্ষ" as one unit. Paste an Arabic sentence and check it displays right-to-left.

**Acceptance Scenarios**:

1. **Given** Bangla, Devanagari, Arabic or CJK text in the editor, **When** it is displayed, **Then** it uses a font with glyphs for that script (no empty boxes), even though the editor's main font is Latin-only.
2. **Given** a Bangla conjunct or a letter with a vowel sign, **When** the user presses Left, Right or Backspace, **Then** the cursor moves or deletes as typical Windows text editing does for that script, and the text never ends up with a stray vowel sign or broken conjunct caused by Lexy.
3. **Given** a line written in a right-to-left script, **When** it is displayed, **Then** it reads right-to-left, while LaTeX commands on the same line stay readable.
4. **Given** Windows' own Bangla keyboard layouts or an input method (such as Avro), **When** the user types in the editor, **Then** the text arrives correctly, including composed characters, with no doubled or lost characters.
5. **Given** the ribbon's Bold, Italic, heading and list actions, **When** used on Bangla text, **Then** they wrap the selection exactly like English text.

---

### User Story 4 - Non-English file, folder and project names work (Priority: P2)

A writer names a project "আমার প্রবন্ধ" or a chapter file "ভূমিকা.tex". Creating, opening, compiling and exporting the PDF all work.

**Why this priority**: Bangla writers will naturally name things in Bangla. The failing log shows the TeX tools switch the console to a Western code page, so non-Latin file names are a real risk.

**Independent Test**: Create a project named "আমার প্রবন্ধ" with a chapter "অধ্যায়/ভূমিকা.tex" included from the main document, compile, and close the window. The PDF appears as "আমার প্রবন্ধ.pdf" beside the main document.

**Acceptance Scenarios**:

1. **Given** a project or main document with a Bangla name, **When** it compiles, **Then** the PDF is produced and exported with the same name.
2. **Given** an included file or image with a non-Latin name, **When** the main document includes it, **Then** it is found.
3. **Given** a font file with a non-Latin name, **When** it is used, **Then** it is found, or Lexy explains that the file must be renamed with a clear message.

---

### User Story 5 - Missing LaTeX packages install themselves (Priority: P3)

A writer uses a language package that is not installed yet (for example a first Bangla document on a new machine). The compile installs it automatically and succeeds, with a visible "Installing package …" status, and never stops at a hidden prompt.

**Why this priority**: The user's machine already had LaTeXbangla, but a fresh install will not. A hidden install question would make a compile hang until the timeout.

**Independent Test**: On a machine without the `latexbangla` package, compile the example; the status shows the package being installed and the PDF appears.

**Acceptance Scenarios**:

1. **Given** a package that is not installed, **When** the document needs it, **Then** it is installed without any dialog and the compile continues.
2. **Given** no internet connection, **When** a package is missing, **Then** the compile fails with a summary that names the missing package and says it could not be downloaded.

---

### Edge Cases

- A document loads fontspec only inside an `\iftutex` branch (works on both engines): Lexy uses the Unicode engine, which handles both branches.
- The `\usepackage{latexbangla}` line is commented out: it is ignored when choosing the engine.
- The package is loaded from a sub-file through `\input`: the choice also covers packages loaded in the main document's included preamble files (files the main document inputs before `\begin{document}`).
- The project also contains a local copy of LaTeXbangla's files (the "copy beside your document" install from its README): the local copy is used, as LaTeX normally prefers files beside the document.
- XeLaTeX is slower than pdfLaTeX: live preview keeps working and only the newest change is compiled (existing behaviour).
- Biber is needed for Bangla bibliographies (biblatex with `backend=biber`): the compile runs it automatically, as with English bibliographies.
- A Bangla font without bold or italic faces: LaTeXbangla's own fallbacks apply; Lexy does not change fonts.
- The user picks an installed font in Lexy's font picker that has no Latin letters: the existing XeLaTeX path works, but English text may show missing glyphs; this is the font's limit, not a Lexy error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Lexy MUST choose a Unicode engine (XeLaTeX by default) when the main document, or a preamble file it includes, loads a package or class that requires XeLaTeX or LuaLaTeX, including at least: latexbangla, fontspec, polyglossia, unicode-math, xeCJK, luatexja, bidi, and classes known to require them (bookbangla).
- **FR-002**: An explicit engine line in the first lines of the main document MUST always override the automatic choice.
- **FR-003**: Commented-out lines MUST NOT affect the engine choice.
- **FR-004**: Documents with no Unicode-engine package MUST keep compiling with pdfLaTeX.
- **FR-005**: The engine actually used MUST be visible to the user (status tooltip and log summary).
- **FR-006**: Fonts installed for all users and for the current user only MUST be usable by family name.
- **FR-007**: Font files inside the project folder MUST be usable by file name, with or without a project-relative path, during both live preview and explicit compiles.
- **FR-008**: When a font cannot be found, the compile summary MUST name the font in plain words.
- **FR-009**: Lexy's font, size and page settings MUST keep working in documents that use LaTeXbangla, and MUST NOT remove or rewrite LaTeXbangla's font lines.
- **FR-010**: The editor MUST display any Unicode script with a font that covers it, without clipping glyphs vertically.
- **FR-011**: Cursor movement, selection and deletion in the editor MUST treat each user-perceived character (including Bangla conjuncts and vowel signs) as one unit, matching standard Windows text behaviour.
- **FR-012**: Right-to-left lines MUST display in their natural direction in the editor.
- **FR-013**: Text from Windows keyboard layouts and input methods (including composition-based ones) MUST be inserted correctly.
- **FR-014**: Project, folder and file names in any script MUST work for creating, opening, including, compiling and exporting the PDF.
- **FR-015**: Missing LaTeX packages MUST be installed automatically during a compile, without dialogs. Failure to install MUST name the package in the summary.
- **FR-016**: Bangla bibliographies that need biber MUST compile with the same F5 action as any other document.

### Key Entities

- **Engine choice**: the TeX engine for one compile; comes from the explicit engine line, otherwise from the packages the document loads, otherwise pdfLaTeX.
- **Unicode-engine package list**: the known packages and classes that require XeLaTeX or LuaLaTeX; maintained by Lexy and extended over time.
- **Font source**: where a named font comes from: system-wide install, current-user install, or a file in the project folder.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The unmodified LaTeXbangla `examples/bangla.tex` and `examples/assamese.tex` compile in Lexy on the first F5 with an installed tested font, 10 out of 10 times.
- **SC-002**: A user who has never used Lexy produces a correct Bangla PDF from LaTeXbangla's README example in under 2 minutes, with no engine line or settings change.
- **SC-003**: Documents in at least five scripts (Bangla, Devanagari, Arabic, Chinese, Latin with accents) compile and display correctly in the editor, using one test document each.
- **SC-004**: A font kept in the project folder is used in 100% of compiles, including live preview, with no system install.
- **SC-005**: All existing English documents compile with the same engine as before (no pdfLaTeX document moves to XeLaTeX).
- **SC-006**: A compile that needs a missing package never waits on a hidden prompt; it either succeeds or fails with a named package within the normal compile time limit.

## Assumptions

- No "one-click Bangla document" option, templates, or phonetic typing in this feature (user's choice, 2026-11-13). Writers type with Windows keyboards or their own input method (for example Avro).
- LaTeXbangla is used as published (MiKTeX package, or a local copy in the project); Lexy does not bundle or modify it.
- XeLaTeX is the default Unicode engine because Lexy already uses it for installed fonts; LuaLaTeX is used only when the document asks for it.
- The fonts themselves are the user's: Lexy does not download fonts. Windows ships Nirmala UI, which covers Bangla, so the editor can always display Bangla.
- The minimum TeX version required by LaTeXbangla (2024 or later) is met by the MiKTeX that Lexy installs; older installs are out of scope.
- Git integration (init, commit, push from a Git ribbon tab) is a separate feature, logged in TRACKER intake for its own spec.
