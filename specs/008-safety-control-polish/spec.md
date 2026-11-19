# Feature Specification: Safety and Control Polish

**Feature Branch**: `008-safety-control-polish`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "Safety and control polish (spec 008), four features for Lexy: (1) Stop button for a running compile (finishes tracker F-017). (2) Recover unsaved text after a crash or power loss. (3) Choose the engine from the UI (pdfLaTeX / XeLaTeX / LuaLaTeX / Automatic). (4) Find text in the PDF preview." Source: the 2026-11-18 code review rows in the `docs/TRACKER.md` Manual Feature Intake. Excluded: code signing, in-app updates, Bangla spell dictionary and MiKTeX updates (each needs an owner decision first).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recover unsaved text after a crash (Priority: P1)

A writer has been typing for twenty minutes without saving (auto-save is off by default). The laptop loses power. When they start Lexy again and the project opens, Lexy says it found unsaved text from the last session and lists each affected file. For each file they choose Restore (the recovered text appears in the editor as an unsaved change, exactly as if they had never closed) or Discard. Nothing is written to their project files until they save.

**Why this priority**: Losing work is the worst thing an editor can do. Today a crash, power loss or forced shutdown loses every unsaved edit; this is the only story that prevents data loss.

**Independent Test**: Edit a file without saving, end the Lexy process from Task Manager, start Lexy again, and check that the edit can be restored and that the file on disk did not change.

**Acceptance Scenarios**:

1. **Given** a project with an unsaved edit made more than 10 seconds ago, **When** Lexy is ended abnormally and started again, **Then** the project opens with a notice listing the file with unsaved text and offering Restore and Discard.
2. **Given** the recovery notice, **When** the writer chooses Restore for a file, **Then** that file opens with the recovered text as an unsaved change (marked unsaved, one undo step back to the disk text) and the file on disk is unchanged.
3. **Given** the recovery notice, **When** the writer chooses Discard, **Then** the recovered copy is deleted and the file shows the disk text.
4. **Given** a writer who saves all files, or closes Lexy normally (saving or choosing Don't save), **When** Lexy starts again, **Then** no recovery notice appears.
5. **Given** a file that was changed on disk after the crash (for example by Git or another editor), **When** the writer restores it, **Then** Lexy says the file changed since the recovered text was made, and the writer keeps both (recovered text in the editor, disk text available through the existing Reload / Keep mine choice).

---

### User Story 2 - Stop a running compile (Priority: P1)

A writer starts a compile that hangs (for example a runaway loop, or a missing package that MiKTeX is slowly trying to download). Instead of waiting up to three minutes, they press Stop next to the compile status (or Shift+F5). The compile ends within a couple of seconds, the PDF they had stays on screen, the status reads "Compile stopped", and the next compile, explicit or from live preview, works normally.

**Why this priority**: A stuck compile currently blocks every other compile for up to 180 seconds with no way out, which feels like the app has frozen. This finishes F-017.

**Independent Test**: Compile a document containing an endless loop, press Stop, and check that the status changes within 2 seconds, no compiler processes remain, the previous PDF is still shown, and a following compile succeeds.

**Acceptance Scenarios**:

1. **Given** a compile is running (explicit or live preview), **When** the writer presses Stop or Shift+F5, **Then** the compile and every process it started end within 2 seconds and the status reads "Compile stopped".
2. **Given** a compile was stopped, **When** the writer looks at the preview, **Then** the last successful PDF is still shown and PDF ↔ source jumps still match it.
3. **Given** a compile was stopped, **When** the writer compiles again (F5 or by typing with live preview on), **Then** the compile runs normally and does not reuse half-written output from the stopped run.
4. **Given** live preview has a compile running and another queued, **When** the writer presses Stop, **Then** both are dropped; live preview starts again on the next edit.
5. **Given** no compile is running, **When** the writer looks at the status area, **Then** Stop is not offered (or is disabled) and Shift+F5 does nothing.
6. **Given** the window is closing and an export compile is running, **When** the writer presses Stop, **Then** the export is cancelled and the existing close flow reports that the PDF was not updated.

---

### User Story 3 - Choose the TeX engine (Priority: P2)

A writer whose document needs LuaLaTeX (or who wants to force pdfLaTeX) opens the engine choice and picks Automatic, pdfLaTeX, XeLaTeX or LuaLaTeX. Lexy writes or removes the engine line at the top of the main document in one undo step, recompiles, and shows which engine the last compile used.

**Why this priority**: Today the engine can only be changed by typing a `% !TEX program` line by hand; LuaLaTeX is otherwise unreachable. Useful but not data-protecting, so it follows the two P1 stories.

**Independent Test**: Choose LuaLaTeX, check the main document's first line, undo once, check the line is gone, compile, and check the status shows the engine actually used.

**Acceptance Scenarios**:

1. **Given** a main document without an engine line, **When** the writer chooses XeLaTeX, **Then** the line `% !TEX program = xelatex` is added as line 1 in one undo step and the next compile uses XeLaTeX.
2. **Given** a main document with an engine line in its first five lines, **When** the writer chooses another engine, **Then** that line is replaced in place (no second line is added).
3. **Given** a main document with an engine line, **When** the writer chooses Automatic, **Then** the line is removed and Lexy chooses the engine as it does today.
4. **Given** any compile has finished, **When** the writer opens the engine choice, **Then** the current choice is checked and the engine the last compile used is shown with its reason (marker, package, or automatic Bangla handling).
5. **Given** a document whose font setting needs XeLaTeX or LuaLaTeX (an installed or project font), **When** the writer chooses pdfLaTeX, **Then** Lexy warns that the font needs XeLaTeX or LuaLaTeX and still applies the choice if the writer confirms.
6. **Given** a different file than the main document is shown, **When** the writer chooses an engine, **Then** the main document is edited (like the other document settings), not the shown file.

---

### User Story 4 - Find text in the PDF preview (Priority: P3)

A writer wants to find where a phrase appears in the typeset output. With the PDF focused they press Ctrl+F; a small find bar opens over the preview. As they type, matches are highlighted on every page and the bar shows "3 of 12". Enter and Shift+Enter step to the next and previous match, scrolling it into view; Esc closes the bar and removes the highlights.

**Why this priority**: Helpful for long documents, but source search (Ctrl+Shift+F) and PDF ↔ source jumps already cover most needs.

**Independent Test**: Compile a multi-page document, focus the PDF, press Ctrl+F, type a word that appears several times, step through the matches with Enter / Shift+Enter, and press Esc.

**Acceptance Scenarios**:

1. **Given** the PDF preview has focus, **When** the writer presses Ctrl+F, **Then** a find bar opens with the cursor in its text field; Ctrl+F in the editor keeps opening the editor's own search.
2. **Given** the find bar is open, **When** the writer types text, **Then** every match on every page is highlighted, the current match is marked differently, and the bar shows "n of m" (or "No results").
3. **Given** matches exist, **When** the writer presses Enter or Shift+Enter, **Then** the next or previous match becomes current and is scrolled into view, wrapping around at the ends.
4. **Given** the find bar is open, **When** the PDF is replaced by a new compile, **Then** the search runs again on the new PDF and keeps the current match as close as possible to where it was.
5. **Given** the find bar is open, **When** the writer presses Esc, **Then** the bar closes, highlights disappear and focus returns to the PDF.

---

### Edge Cases

- Recovery while two windows show the same project: only the window that can edit (not read-only) keeps recovery copies; the read-only window never writes or offers them.
- Recovery for a file that was deleted or renamed after the crash: it is offered under its old name; restoring it opens it as an unsaved file that saving re-creates.
- Recovery for a project that is not opened again: copies older than 30 days are removed, like local snapshots.
- Recovered text identical to the disk text: not offered.
- Recovery copies are not cleared when the writer closes with unsaved files and chooses Cancel; the window stays open and copies keep updating.
- A crash during writing a recovery copy must never leave a broken copy that replaces a good one.
- Stop pressed just as the compile finishes: the result is either the finished PDF or "Compile stopped", never a half-shown PDF or a stuck status.
- Stop during an automatic MiKTeX package install: the install is cut off; the next compile may try again.
- Engine choice in a read-only window: not offered.
- Engine line written in a non-standard form (for example `%!TeX TS-program = lualatex`): recognised and replaced, not duplicated.
- Find in a PDF without a text layer (for example scanned pages) or in scripts whose PDF text cannot be read back: shows "No results" rather than failing.
- Find text that breaks across a line or a hyphen in the PDF: matched when the words are on the same page.
- Find while no PDF exists yet: Ctrl+F on the empty preview does nothing.

## Requirements *(mandatory)*

### Functional Requirements

**Crash recovery (US1)**

- **FR-001**: Lexy MUST keep a recovery copy of every open file with unsaved changes, updated no later than 10 seconds after the last change while the file stays unsaved.
- **FR-002**: Recovery copies MUST be stored outside the project folder, in Lexy's own per-user data area, and MUST never be written into the project.
- **FR-003**: Writing a recovery copy MUST NOT change the file on disk, the unsaved state, the undo history or the editor's responsiveness.
- **FR-004**: When a project opens and recovery copies exist that differ from the current disk text, Lexy MUST show one notice listing those files with Restore and Discard for each, plus Restore all and Discard all.
- **FR-005**: Restore MUST open the file with the recovered text as an unsaved change that one undo returns to the disk text; Lexy MUST NOT write the recovered text to the project until the writer saves.
- **FR-006**: If a file changed on disk after its recovery copy was made, Restore MUST say so; the disk text MUST stay reachable through the existing outside-change choice (Reload / Keep mine).
- **FR-007**: A file's recovery copy MUST be removed when the file is saved, when its unsaved changes are discarded, and when the writer discards it from the notice; all of a project's copies MUST be removed when the project is closed normally.
- **FR-008**: Read-only windows MUST NOT write, offer or remove recovery copies.
- **FR-009**: Recovery copies older than 30 days MUST be removed automatically.
- **FR-010**: A failure while writing a recovery copy MUST leave the previous copy intact and MUST NOT interrupt editing; repeated failures MAY be reported once per session.

**Stop compile (US2)**

- **FR-011**: While a compile runs, Lexy MUST offer a Stop control next to the compile status and accept Shift+F5; neither is active when no compile runs.
- **FR-012**: Stop MUST end the running compile and every process it started within 2 seconds.
- **FR-013**: After Stop, the status MUST read "Compile stopped", the last successful PDF MUST stay shown and in sync with source jumps, and the log drawer MUST NOT open by itself.
- **FR-014**: Stop MUST also drop a queued live-preview compile; live preview MUST resume on the next edit.
- **FR-015**: The next compile after Stop MUST behave like a normal compile and MUST NOT reuse partial output from the stopped run.
- **FR-016**: Stop MUST be available for the export compile that runs when leaving a project; the close flow MUST then report that the PDF was not updated.
- **FR-017**: The existing 180-second timeout MUST remain as a fallback.

**Engine choice (US3)**

- **FR-018**: Lexy MUST offer the engine choices Automatic, pdfLaTeX, XeLaTeX and LuaLaTeX, with the current choice marked, from the ribbon and the command palette.
- **FR-019**: Choosing an engine MUST edit only the main document's engine line: add it as line 1, replace an existing one in the first five lines, or remove it for Automatic, as exactly one undo step; no other preamble line may change.
- **FR-020**: Lexy MUST recognise the common spellings of the engine line (any case, with or without `TS-`, with or without a space after `%`) so it replaces rather than duplicates.
- **FR-021**: Lexy MUST show the engine the last compile used and why (engine line, package, automatic Bangla handling) next to the engine choice.
- **FR-022**: Choosing pdfLaTeX while the document's font setting needs a Unicode engine MUST show a warning; the writer MAY continue.
- **FR-023**: An explicit engine choice MUST be honoured by the compile; the automatic Bangla switch MUST only apply when the choice is Automatic.
- **FR-024**: The engine choice MUST NOT be offered in read-only windows.

**Find in PDF (US4)**

- **FR-025**: Ctrl+F while the PDF preview has focus MUST open a find bar; Ctrl+F elsewhere keeps its current meaning.
- **FR-026**: The find bar MUST search the text of every page, ignoring case and treating runs of whitespace and line breaks as one space.
- **FR-027**: All matches MUST be highlighted, the current match visibly different, and the bar MUST show "n of m" or "No results"; highlights MUST meet the project's contrast rules in light, dark and Windows contrast themes.
- **FR-028**: Enter and Shift+Enter (and next/previous buttons) MUST move to the next and previous match, scroll it into view and wrap at the ends.
- **FR-029**: When a new PDF replaces the shown one, an open search MUST run again and keep the current match near its previous position.
- **FR-030**: Esc MUST close the bar, remove highlights and return focus to the PDF.
- **FR-031**: The find bar MUST be keyboard and screen-reader usable (labelled field, buttons with names, match count announced).

### Key Entities

- **Recovery copy**: the unsaved text of one file in one project, with the project, the project-relative path, the time it was made, and a fingerprint of the disk text it was based on (to tell whether the disk changed since).
- **Engine choice**: Automatic or one engine, stored only as the engine line in the main document.
- **Compile run**: a running compile that can be stopped; ends as succeeded, failed, timed out or stopped.
- **PDF search**: the query, the list of matches (page and position) and the current match.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 20 forced-termination trials, 100% of text typed at least 10 seconds before termination is offered for recovery, and the project files are unchanged in every trial.
- **SC-002**: After a normal close or a full save, 0 recovery notices appear on the next start, in 20 trials.
- **SC-003**: Typing speed is unaffected by recovery: no keystroke takes noticeably longer to appear while recovery copies are written (same latency, within 10%, as with recovery off, on a 500-line file).
- **SC-004**: In 95% of stops, the status reads "Compile stopped" and no compiler process remains within 2 seconds of pressing Stop.
- **SC-005**: After a stop, the next compile succeeds on the first try in 100% of 20 trials.
- **SC-006**: Changing the engine takes at most 2 actions and is reverted with exactly 1 undo; the engine shown after the next compile matches the choice in 100% of cases (all four choices tested).
- **SC-007**: On a 50-page document, the first PDF search results appear within 1 second of typing and stepping to the next match takes under 300 ms.
- **SC-008**: All new controls are usable by keyboard alone and pass the project's existing contrast checks in light and dark themes.

## Assumptions

- Recovery copies are made from the editor's in-memory text; crashes of the whole operating system before the first copy is written (under 10 seconds of typing) can still lose that last bit of text.
- Recovery copies live under `%LOCALAPPDATA%\Lexy` next to the existing snapshots, follow the same 30-day pruning, and are separate from snapshots (snapshots keep saved versions; recovery keeps unsaved text).
- A normal close is any close that goes through the existing unsaved-changes flow (Save all or Don't save); Cancel keeps the session open.
- Shift+F5 is chosen for Stop because F5 compiles and Shift+F5 is the usual Windows "stop" companion (as in Visual Studio); it does not conflict with existing Lexy shortcuts.
- The engine choice reuses the existing engine line format and the rule that the line in the first five lines wins; no new file or setting stores the choice.
- An explicit pdfLaTeX choice turning off the automatic Bangla switch matches today's behaviour (the switch already applies only when no engine line or package decides); the engine tooltip makes the reason visible.
- PDF find covers the shown PDF only (not the source); source search stays Ctrl+Shift+F.
- Text extraction quality depends on the PDF; shaped scripts such as Bangla may not always be found in the PDF text. This is accepted for this version.
- Out of scope: code signing, in-app updates, more spell-check dictionaries and MiKTeX package updates (tracked in the Manual Feature Intake pending owner decisions).
