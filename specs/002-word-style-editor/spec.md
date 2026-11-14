# Feature Specification: Word-Style Writing Experience

**Feature Branch**: `002-word-style-editor`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "The app is running and compile correctly. Also, by default it should save in Document/lexy folder, And the UI should be redesign more with options to add fonts/change fonts, slightly like to MS word UI, equation input, live preview, margin, table etc."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Live preview while typing (Priority: P1)

A writer types in the editor and the PDF on the right updates by itself a moment after they stop typing, keeping their place in the PDF. They never have to press Compile or save first to see the result.

**Why this priority**: "See what you are writing" is the core of a Word-like feel; every other ribbon feature shows its effect through the preview.

**Independent Test**: Turn Live preview on, type a sentence, stop; the preview updates within a few seconds without saving the file and without jumping back to page 1.

**Acceptance Scenarios**:

1. **Given** Live preview is on, **When** the user stops typing for about 1 second, **Then** the preview recompiles from the current text and shows the new PDF.
2. **Given** an untitled, never-saved document, **When** Live preview runs, **Then** the preview still updates and no file is written to the user's folders.
3. **Given** the user is reading page 3, **When** the preview refreshes, **Then** it stays on (about) the same page and scroll position.
4. **Given** a compile is already running, **When** the user keeps typing, **Then** at most one more compile runs afterwards, using the latest text.
5. **Given** the latest live compile fails, **When** the preview refreshes, **Then** the last good PDF stays visible with a short error line; the log drawer does **not** pop open on every keystroke.
6. **Given** Live preview is off, **When** the user types, **Then** nothing compiles until they press Compile (F5).

---

### User Story 2 - Documents save to Documents\Lexy by default (Priority: P1)

When the user saves a new document, the save dialog opens in a `Lexy` folder inside their Documents folder, which Lexy creates if it does not exist.

**Why this priority**: Users should not have to hunt for where their work went; this was asked for explicitly.

**Independent Test**: On a machine with no `Documents\Lexy`, press Save on a new document; the dialog opens in `Documents\Lexy` (now created) with `Untitled.tex` suggested.

**Acceptance Scenarios**:

1. **Given** a new document, **When** the user saves, **Then** the dialog starts in `Documents\Lexy` with the name `Untitled.tex`.
2. **Given** `Documents\Lexy` does not exist, **When** the save dialog is about to open, **Then** Lexy creates the folder first.
3. **Given** the user's Documents folder is redirected (e.g. OneDrive), **When** saving, **Then** Lexy uses the redirected Documents folder.
4. **Given** a document already saved elsewhere, **When** the user chooses Save as, **Then** the dialog starts at that document's current location.
5. **Given** Open is used, **When** the dialog appears, **Then** it also starts in `Documents\Lexy`.

---

### User Story 3 - Word-style ribbon (Priority: P2)

Commands live in a tabbed ribbon (File, Home, Insert, Layout, View) with grouped, labelled buttons, similar in spirit to Microsoft Word, instead of a single icon strip. Home holds text formatting (bold, italic, underline, headings, lists); Insert holds equation, table, page break and footnote; Layout holds page and margin settings; View holds live preview and logs.

**Why this priority**: The ribbon is the frame every new feature hangs off, but each feature can be demonstrated without it.

**Independent Test**: Switch between ribbon tabs with the mouse and keyboard; select text and press Bold; `\textbf{…}` wraps the selection and the preview shows bold text.

**Acceptance Scenarios**:

1. **Given** the writer is open, **When** the user looks at the top, **Then** they see ribbon tabs File, Home, Insert, Layout, View with Home selected.
2. **Given** text is selected, **When** the user presses Bold / Italic / Underline (or Ctrl+B / Ctrl+I / Ctrl+U), **Then** the selection is wrapped in the matching LaTeX command; with no selection the empty command is inserted with the cursor inside.
3. **Given** the cursor is on a line, **When** the user picks a style (Heading 1/2/3), **Then** the line becomes `\section{…}` / `\subsection{…}` / `\subsubsection{…}`.
4. **Given** lines are selected, **When** the user presses Bullets or Numbering, **Then** they become an `itemize` / `enumerate` list.
5. **Given** the ribbon at the 800x600 minimum window, **When** shown, **Then** all groups are reachable without overlap (groups may collapse to icon-only).
6. **Given** keyboard use, **When** the user tabs and uses arrow keys in the tab list, **Then** tabs and buttons are reachable with visible focus and accessible names.

---

### User Story 4 - Change the document font and size (Priority: P2)

From Home, the user picks a document font from a list (e.g. Latin Modern, Times, Palatino, Helvetica, Charter, Libertine) and a base size (10, 11, 12 pt). They can also choose any font installed on Windows (e.g. Calibri, Georgia); Lexy then switches the document to an engine that supports system fonts.

**Why this priority**: Explicitly requested ("add fonts/change fonts"); changes the whole look of the document.

**Independent Test**: Pick "Palatino" → preview shows Palatino; pick system font "Georgia" → preview shows Georgia and the document now compiles with the system-font engine.

**Acceptance Scenarios**:

1. **Given** a document, **When** the user picks a built-in font, **Then** the preamble's Lexy settings block uses that font and the preview reflects it.
2. **Given** a document, **When** the user picks an installed Windows font, **Then** Lexy marks the document to compile with the system-font engine and loads that font.
3. **Given** the user switches back to a built-in font, **Then** the system-font engine marker is removed.
4. **Given** a base size is picked, **When** applied, **Then** the document class option changes to that size.
5. **Given** a document whose preamble Lexy did not write, **When** the user opens the font picker, **Then** it shows "Default" and applying a font adds Lexy's settings block without altering the user's other preamble lines.

---

### User Story 5 - Insert equations with a visual preview (Priority: P2)

From Insert → Equation, the user gets an equation editor: a palette of common structures (fraction, root, power, subscript, sum, integral, limit, matrix, Greek letters, operators) and a text field, with a rendered preview of the equation as they type. They choose inline or display and insert it at the cursor.

**Why this priority**: Explicitly requested; equations are the main reason people use LaTeX.

**Independent Test**: Open Equation, click Fraction, type `a` and `b`, see a rendered a/b, choose Display, Insert → an `equation` environment appears at the cursor and in the preview.

**Acceptance Scenarios**:

1. **Given** the equation editor, **When** the user clicks a palette item, **Then** its LaTeX is inserted into the field with placeholders selected for typing.
2. **Given** the user types math, **When** typing, **Then** the rendered preview updates immediately; invalid math shows a readable error instead of a preview.
3. **Given** Inline is chosen, **When** inserting, **Then** `\( … \)` is placed at the cursor; for Display, a numbered `equation` environment on its own lines.
4. **Given** the cursor is inside an existing equation, **When** the user opens Equation, **Then** that equation is loaded for editing and Insert replaces it.
5. **Given** the dialog, **When** Esc or Cancel, **Then** nothing changes in the document.

---

### User Story 6 - Page layout and margins (Priority: P2)

From Layout, the user picks margins (Normal, Narrow, Moderate, Wide, or Custom top/bottom/left/right), paper size (A4, Letter) and orientation (portrait, landscape).

**Why this priority**: Explicitly requested ("margin"); common Word task.

**Independent Test**: Choose Narrow margins → preview text block widens; choose Custom 3 cm left → preview reflects it.

**Acceptance Scenarios**:

1. **Given** a preset is picked, **When** applied, **Then** the settings block carries matching page geometry and the preview updates.
2. **Given** Custom, **When** the user enters values, **Then** each must be between 0.5 and 6 cm; invalid values are rejected with a message and not applied.
3. **Given** paper or orientation changes, **When** applied, **Then** the preview page size changes accordingly.

---

### User Story 7 - Insert tables (Priority: P3)

From Insert → Table, the user drags over a grid (up to 10x8) like Word, or opens "Insert table…" to set rows, columns, header row, borders, alignment and an optional caption. A table skeleton is inserted at the cursor.

**Why this priority**: Explicitly requested ("table"); useful but less frequent than text and equations.

**Independent Test**: Hover a 3x2 grid, click → a 3-column, 2-row table appears in source and preview.

**Acceptance Scenarios**:

1. **Given** the grid picker, **When** the user hovers, **Then** it shows the size (e.g. "3 x 2 Table"); clicking inserts that table.
2. **Given** "Insert table…", **When** header row and borders are on, **Then** the first row is set off with rules and cells have borders.
3. **Given** a caption is entered, **When** inserted, **Then** the table is wrapped in a floating table with that caption.
4. **Given** rows or columns outside 1–50 / 1–20, **When** entered, **Then** they are rejected.

### Edge Cases

- User has hand-written `geometry` or font packages in their preamble: Lexy's settings block must not duplicate or fight them; Lexy warns once ("This document already sets margins; Lexy's setting may conflict") rather than editing user lines.
- System font name containing characters that are special in LaTeX (`{`, `}`, `\`, `%`, `#`): rejected or escaped so it cannot break or inject into the document.
- Live preview on a very large document: compile time exceeds the typing pause; requests coalesce so compiles never pile up.
- Live preview with a document that has `\input{chapter1}` and was saved: included files next to the document still resolve.
- Untitled document and `\input` of a relative file: cannot resolve (no folder yet); the error is shown like any compile error.
- Missing LaTeX package for a chosen font (MiKTeX installs on demand): first compile may be slow or fail with "package not found"; message points to the log.
- Equation preview renderer cannot render something LaTeX can (rare commands): the preview says it cannot preview, insertion is still allowed.
- Documents folder unavailable (policy, offline OneDrive): fall back to the user's home folder and say so.

## Requirements *(mandatory)*

### Functional Requirements

**Saving location**

- **FR-001**: New documents' Save/Save as dialogs MUST start in `<Documents>\Lexy`, using the Windows Documents known folder (honouring redirection), creating the `Lexy` folder if missing.
- **FR-002**: Open MUST start in `<Documents>\Lexy`; Save as of an already-saved document MUST start at its current path.
- **FR-003**: If the Documents folder cannot be resolved or created, Lexy MUST fall back to the user's home folder and show a one-line notice.

**Live preview**

- **FR-004**: The app MUST offer a Live preview toggle (on by default, remembered between sessions).
- **FR-005**: With Live preview on, the app MUST compile the current editor text ~1 s after the last edit, without writing to the document's file.
- **FR-006**: Live compiles MUST coalesce: never more than one running plus one queued, the queued one always using the newest text.
- **FR-007**: Included files relative to a saved document's folder MUST still resolve during live compiles.
- **FR-008**: The preview MUST keep the reader's page/scroll position across refreshes and MUST NOT flash blank between them.
- **FR-009**: A failed live compile MUST keep the last good PDF and show a one-line error in the status area; the log drawer opens automatically only for explicit compiles (F5/Compile).

**Ribbon**

- **FR-010**: The command area MUST be a tabbed ribbon with tabs File, Home, Insert, Layout, View, each with labelled groups; it MUST fit the 800x600 minimum by collapsing groups to icons, never overlapping.
- **FR-011**: File MUST hold New, Open, Save, Save as (existing behaviour and shortcuts unchanged).
- **FR-012**: Home MUST hold Bold, Italic, Underline (Ctrl+B/I/U), style (Normal, Heading 1–3), Bullets, Numbering, plus font family and size.
- **FR-013**: Insert MUST hold Equation, Table, Page break, Footnote.
- **FR-014**: Layout MUST hold Margins, Paper size, Orientation.
- **FR-015**: View MUST hold Live preview toggle and Show/Hide logs.
- **FR-016**: Ribbon tabs MUST follow the tablist keyboard pattern; every control MUST have an accessible name and tooltip.

**Fonts and page settings**

- **FR-017**: Document-wide settings (font, base size, margins, paper, orientation) MUST be stored inside the `.tex` file in one clearly marked Lexy settings block in the preamble (plus the class size option), so the file stays portable and readable.
- **FR-018**: Lexy MUST only ever edit its own block and the class options; it MUST NOT modify other user preamble lines.
- **FR-019**: Built-in fonts MUST work with the default engine; choosing an installed Windows font MUST switch the document to the system-font engine via a standard engine marker at the top of the file, and switching back MUST remove it.
- **FR-020**: The font list MUST include installed Windows font families; font names MUST be validated so they cannot inject LaTeX.
- **FR-021**: Custom margins MUST accept 0.5–6 cm per side (Word's Wide preset is 5.08 cm); invalid input MUST not be applied.

**Equations and tables**

- **FR-022**: The equation editor MUST show a rendered preview that updates as the user types, and a palette covering at least: fraction, square/nth root, superscript, subscript, sum, product, integral, limit, matrix (2x2, 3x3), Greek letters, common relations/operators/arrows.
- **FR-023**: Equations MUST insert as inline `\( … \)` or display `equation` environment at the cursor; editing an existing equation MUST replace it.
- **FR-024**: Tables MUST be insertable via a hover grid (up to 10x8) and a dialog (rows 1–50, columns 1–20, header row, borders, column alignment, optional caption).
- **FR-025**: All insert/format commands MUST be a single undoable edit in the editor.

### Key Entities

- **Document settings**: font choice (built-in id or system family), base size, paper, orientation, margins (four values in cm), and the derived engine; lives in the `.tex` file.
- **Live preview state**: on/off, whether a compile is running, whether one is queued, last good PDF, last error line.
- **Equation draft**: math text, inline/display mode, render result (ok or error), optional range of an equation being edited.
- **Table spec**: rows, columns, header row, borders, alignment, caption.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With Live preview on, a typical 2-page document's preview updates within 3 seconds of the user pausing.
- **SC-002**: During 2 minutes of continuous typing, at most one compile runs at a time and the final preview matches the final text.
- **SC-003**: A first-time user can change the font, set narrow margins, insert a 3x3 table and a fraction equation in under 2 minutes without typing LaTeX.
- **SC-004**: 100% of documents saved without choosing a folder land in `Documents\Lexy`.
- **SC-005**: After any ribbon action, the `.tex` file still compiles (no broken preamble), verified across all fonts × margin presets × both paper sizes.
- **SC-006**: Every ribbon control is reachable by keyboard and has an accessible name.

## Assumptions

- "Slightly like MS Word" means a Word-style ribbon and live PDF preview **on top of the LaTeX source editor**; the source stays visible and editable. A WYSIWYG editor that hides LaTeX is out of scope.
- Font and size are document-wide; per-selection fonts are out of scope.
- Images, headers/footers, page numbers styling, track changes, spell check and templates are out of scope for this feature.
- The equation preview is a fast in-app math renderer; the PDF remains the source of truth.
- Live preview uses about a 1-second pause; this can be tuned later from Settings (F-033).
- MiKTeX installs missing packages on demand; if that is disabled on a machine, the compile error explains which package is missing.
- `Documents\Lexy` means the Windows Documents known folder + `Lexy`.
- The existing shortcuts (Ctrl+N/O/S, Ctrl+Shift+S, F5, Ctrl+L) stay unchanged.
