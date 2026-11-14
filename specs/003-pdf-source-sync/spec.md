# Feature Specification: Click-to-Jump Between PDF and Source

**Feature Branch**: `003-pdf-source-sync`

**Created**: 2026-11-13

**Status**: Draft (extended 2026-11-14: live preview stability and actionable errors)

**Input**: User description: "Find the internet for interesting lexy features from the internet and ask me to add which features" — user picked all eight researched features; this spec covers the top pick, click-to-jump between the PDF preview and the source. The other seven are logged in `docs/TRACKER.md` Manual Feature Intake.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jump from the PDF to the source (Priority: P1)

A writer reading the preview spots a typo in a paragraph. They double-click that spot in the PDF, and the editor scrolls to the matching line, places the cursor there and briefly highlights the line, so they can fix it without searching.

**Why this priority**: Finding where preview text lives in the source is the most frequent navigation task in a long document, and the one the other editors (TeXstudio, Overleaf, LaTeX Workshop, Typst editors) all solve this way.

**Independent Test**: Compile a multi-page document, double-click a word on page 2 of the preview, and confirm the editor shows and highlights the line that produced it.

**Acceptance Scenarios**:

1. **Given** a compiled document is shown in the preview, **When** the user double-clicks text in the PDF, **Then** the editor scrolls to the source line that produced that text, places the cursor on it, focuses the editor and highlights the line for about one second.
2. **Given** the user double-clicks blank space (a margin or between paragraphs), **When** a nearest source location exists, **Then** the editor jumps to the nearest line; otherwise nothing happens and no error is shown.
3. **Given** the double-clicked text comes from another project file pulled in with `\input` or `\include`, **When** the jump resolves to that file, **Then** Lexy opens that file in the editor and jumps to the line. Files outside the project (class or package files) are not opened; the status bar names them.

---

### User Story 2 - Jump from the source to the PDF (Priority: P2)

A writer editing a paragraph wants to see how it looks. They press a shortcut (or the View tab button "Show in PDF"), and the preview scrolls to the matching spot and briefly marks it.

**Why this priority**: Useful, but live preview already keeps the PDF close to the edit, so it is less urgent than the reverse direction.

**Independent Test**: Put the cursor in a paragraph on page 3, press the shortcut, and confirm the preview scrolls to page 3 and marks that paragraph.

**Acceptance Scenarios**:

1. **Given** a compiled document and the cursor on a line that produced output, **When** the user presses Ctrl+J or clicks "Show in PDF", **Then** the preview scrolls so the matching spot is visible and marks it for about one second.
2. **Given** the cursor is on a line that produced no output (a comment, a preamble line), **When** the user asks to show it in the PDF, **Then** the preview jumps to the nearest following output; if there is none, the status bar shows "No PDF location for this line".
3. **Given** no PDF has been compiled yet, **When** the user asks to show the line in the PDF, **Then** the status bar shows "Compile first" and nothing else happens.

---

### User Story 3 - Actionable errors and warnings (Priority: P1)

After a compile, errors and warnings appear inline in the editor (underlined line, gutter marker, message on hover) and as a list in a Problems panel. Clicking an item opens the file and puts the cursor on the line.

**Why this priority**: Decoding LaTeX logs is the other half of the slow feedback loop; a clickable list removes the need to read the log.

**Independent Test**: Write `oo` on line 5 of a chapter file and an undefined `ef{x}` in the main file; after the live preview, the chapter line shows an error marker, the main line a warning, and clicking each list item opens the right file at the right line.

**Acceptance Scenarios**:

1. **Given** a compile with errors, **When** it finishes, **Then** each error with a known file and line is marked inline in that file (error color) and listed with file, line and a one-line message.
2. **Given** LaTeX or package warnings that name an input line (undefined references, citations, overfull boxes), **When** the compile finishes, **Then** they are marked and listed as warnings.
3. **Given** a problem in another project file, **When** the user clicks it, **Then** that file opens and the cursor is on the line.
4. **Given** a live (not explicit) compile fails, **When** it finishes, **Then** inline markers update but no drawer opens and focus stays in the editor.
5. **Given** the next compile succeeds, **When** it finishes, **Then** markers from the previous compile are replaced (cleared if none).
6. **Given** a problem without a line (for example a missing font), **When** listed, **Then** it shows without a link and the full log stays one click away.

---

### User Story 4 - Stable, fast preview (Priority: P1)

The preview recompiles after a short pause in typing and swaps in the new PDF without moving: the zoom level and the scroll position stay. When a compile fails, the last good PDF stays visible with a small "Preview is from the last successful compile" note.

**Independent Test**: Zoom to 150 %, scroll to page 3, type; after the preview updates the view is still at 150 % on page 3. Introduce an error; the old PDF stays and the note appears; fix it; the note goes away.

**Acceptance Scenarios**:

1. **Given** live preview is on, **When** the user pauses typing for about one second, **Then** a background compile runs without blocking typing.
2. **Given** the user changed the zoom (buttons, Ctrl+wheel or Ctrl+= / Ctrl+-) or scrolled, **When** a new PDF arrives, **Then** zoom and scroll position are kept.
3. **Given** a compile fails, **When** it finishes, **Then** the last successful PDF and its location data stay in use and the note says so.

---

### Edge Cases

- The text was edited after the last compile: the jump uses the line numbers of the last compiled text, so it may land a few lines off; it never fails or blocks typing. Live preview recompiles within about a second, so the gap is short.
- The last compile failed: the jump uses the last good PDF and its location data, matching what the preview shows.
- A compile is running when the user double-clicks: the jump uses the PDF currently on screen.
- The target line is beyond the end of the current text (lines were deleted): the editor jumps to the last line.
- Untitled (never saved) documents: both directions work the same as for saved documents.
- Location data is missing or unreadable (for example an old PDF): the action does nothing visible apart from the status bar message "Click-to-jump needs a fresh compile".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every compile (explicit and live preview) MUST produce location data that maps PDF positions to source lines, without changing the user's `.tex` file.
- **FR-002**: Double-clicking a point in the preview MUST move the editor cursor to the source line mapped to that point, scroll it into view, focus the editor and highlight the line briefly.
- **FR-003**: Users MUST be able to jump from the current editor line to the PDF with Ctrl+J and with a "Show in PDF" button on the View tab; the preview MUST scroll the matching spot into view and mark it briefly.
- **FR-004**: Location lookups MUST use the data from the PDF currently shown in the preview, never data from a different compile.
- **FR-005**: Jumps that resolve to another project file MUST open that file and move to the line; jumps to files outside the project MUST NOT move the editor and the status bar MUST name the file.
- **FR-006**: When no mapping exists, the app MUST fall back to the nearest mapped line or show a short status message; it MUST NOT open the log drawer or show a dialog.
- **FR-007**: A jump MUST NOT add an undo step, change the text or mark the document as unsaved.
- **FR-008**: The Ctrl+J shortcut and "Show in PDF" button MUST be keyboard-reachable and carry a tooltip with the shortcut, following the existing ribbon conventions.
- **FR-009**: Location lookups MUST only read data inside Lexy's build folder.
- **FR-010**: Every compile MUST return structured problems (severity, project-relative file or none, line or none, message), mapping build-folder and overlay paths back to project files.
- **FR-011**: Problems MUST be shown inline in the editor for every open file and as a clickable list; clicking opens the file at the line.
- **FR-012**: The preview MUST keep zoom and scroll position across updates; users MUST be able to zoom in, out and back to fit width by mouse and keyboard.
- **FR-013**: When a compile fails, the preview MUST keep the last successful PDF and its location data, and say that it is from the last successful compile.

### Key Entities

- **Location data**: the per-compile record that maps between (page, x, y) in the PDF and (file, line) in the compiled source. It belongs to one compile and is replaced when the next successful compile's PDF is shown.
- **Jump target**: the result of a lookup: either a source line in the open document, a line in another file, or "none".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A double-click on body text in the preview lands the editor on the correct source line in at least 95% of tries across a 10-page test document (pdfLaTeX and XeLaTeX).
- **SC-002**: Both jump directions complete in under 300 ms after the click or keypress on a 50-page document.
- **SC-003**: A user can locate and fix a typo seen in the preview in under 10 seconds, without using search.
- **SC-004**: Compile time with location data enabled grows by no more than 10% over today.
- **SC-005**: For a seeded set of 10 common mistakes (undefined control sequence, missing `}`, undefined reference, missing citation, missing file, overfull box…), at least 9 are listed with the correct file and line.
- **SC-006**: A preview update on a 20-page document never changes the zoom and keeps the visible page within one line of where it was.

## Assumptions

- Lexy's PDF engine output and the bundled TeX tools can produce standard PDF-to-source location data during the existing compile; no new dependency is installed.
- Mapping is line-level, not word- or column-level.
- Projects (spec 004) open any project file, so jumps and problem links switch to sub-files. Location data from compiles points at the build snapshot and the `.lexy-overlay` folder, so paths must be mapped back to project-relative paths.
- Ctrl+J is free in the current shortcut set; it is captured by the Writer's window-level listener like the other shortcuts.
- The highlight/mark uses the existing theme colors and works in light and dark mode.
