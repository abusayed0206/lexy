# Feature Specification: Click-to-Jump Between PDF and Source

**Feature Branch**: `003-pdf-source-sync`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "Find the internet for interesting lexy features from the internet and ask me to add which features" — user picked all eight researched features; this spec covers the top pick, click-to-jump between the PDF preview and the source. The other seven are logged in `docs/TRACKER.md` Manual Feature Intake.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jump from the PDF to the source (Priority: P1)

A writer reading the preview spots a typo in a paragraph. They double-click that spot in the PDF, and the editor scrolls to the matching line, places the cursor there and briefly highlights the line, so they can fix it without searching.

**Why this priority**: Finding where preview text lives in the source is the most frequent navigation task in a long document, and the one the other editors (TeXstudio, Overleaf, LaTeX Workshop, Typst editors) all solve this way.

**Independent Test**: Compile a multi-page document, double-click a word on page 2 of the preview, and confirm the editor shows and highlights the line that produced it.

**Acceptance Scenarios**:

1. **Given** a compiled document is shown in the preview, **When** the user double-clicks text in the PDF, **Then** the editor scrolls to the source line that produced that text, places the cursor on it, focuses the editor and highlights the line for about one second.
2. **Given** the user double-clicks blank space (a margin or between paragraphs), **When** a nearest source location exists, **Then** the editor jumps to the nearest line; otherwise nothing happens and no error is shown.
3. **Given** the double-clicked text comes from another file pulled in with `\input`, **When** the jump resolves to that file, **Then** the status bar shows "Text is in <file name>" and the editor does not move.

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
- **FR-005**: Jumps that resolve to a file other than the open document MUST NOT move the editor; the status bar MUST name that file.
- **FR-006**: When no mapping exists, the app MUST fall back to the nearest mapped line or show a short status message; it MUST NOT open the log drawer or show a dialog.
- **FR-007**: A jump MUST NOT add an undo step, change the text or mark the document as unsaved.
- **FR-008**: The Ctrl+J shortcut and "Show in PDF" button MUST be keyboard-reachable and carry a tooltip with the shortcut, following the existing ribbon conventions.
- **FR-009**: Location lookups MUST only read data inside Lexy's build folder.

### Key Entities

- **Location data**: the per-compile record that maps between (page, x, y) in the PDF and (file, line) in the compiled source. It belongs to one compile and is replaced when the next successful compile's PDF is shown.
- **Jump target**: the result of a lookup: either a source line in the open document, a line in another file, or "none".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A double-click on body text in the preview lands the editor on the correct source line in at least 95% of tries across a 10-page test document (pdfLaTeX and XeLaTeX).
- **SC-002**: Both jump directions complete in under 300 ms after the click or keypress on a 50-page document.
- **SC-003**: A user can locate and fix a typo seen in the preview in under 10 seconds, without using search.
- **SC-004**: Compile time with location data enabled grows by no more than 10% over today.

## Assumptions

- Lexy's PDF engine output and the bundled TeX tools can produce standard PDF-to-source location data during the existing compile; no new dependency is installed.
- Mapping is line-level, not word- or column-level.
- Jumping into `\input` files is out of scope until Lexy can open more than one file; v1 only names the file. Update 2026-11-13: projects (spec 004) now open any project file from the sidebar, so the PDF → source jump can switch to the sub-file instead (revise FR-005 and US1 scenario 3 before planning). Location data from compiles points at the build snapshot and the `.lexy-overlay` folder, so paths must be mapped back to project-relative paths.
- Ctrl+J is free in the current shortcut set; it is captured by the Writer's window-level listener like the other shortcuts.
- The highlight/mark uses the existing theme colors and works in light and dark mode.
