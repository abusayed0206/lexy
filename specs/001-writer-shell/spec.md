# Feature Specification: Minimal Writer Shell

**Feature Branch**: `001-writer-shell`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "M1 Minimal Writer Shell for Lexy (see docs/PLAN.md M1, docs/DESIGN.md, tracker F-004, F-005, F-008, F-009): once dependencies are verified, the app opens directly into a writer layout — compact top command strip, monospace LaTeX editor pane on the left, PDF preview pane on the right, and a collapsible status/log drawer at the bottom. A minimal starter LaTeX article is loaded when no file is open. Compile status indicator shows idle/dirty/compiling/success/error states (real compilation is out of scope for M1; preview shows a blank state). Log drawer is collapsed by default and opens on error. Must remain usable at 800x600 and at 100/125/150% Windows scaling; icon-only buttons need accessible names and tooltips. The existing first-run setup screen is shown instead only when dependencies are missing. No landing page or demo content."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open straight into a writing surface (Priority: P1)

A writer launches Lexy on a machine where the LaTeX tools are already set up. The app opens directly to the writer: a compact command strip at the top, a monospace editor on the left already holding a short starter article, and a preview area on the right. They can start typing immediately.

**Why this priority**: This is the core identity of the app — "write LaTeX and see the PDF". Without it there is no writer, only a setup screen.

**Independent Test**: Launch the app on a machine with dependencies present; confirm the writer layout appears with the starter article loaded and the editor accepts typing.

**Acceptance Scenarios**:

1. **Given** all required tools are verified, **When** the app starts, **Then** the writer layout is shown with no landing page, tutorial or demo content.
2. **Given** the writer is open and no file has been opened, **When** the user looks at the editor, **Then** it contains a minimal, compilable starter LaTeX article.
3. **Given** the writer is open, **When** the user types in the editor, **Then** the text appears in a monospace font and the edit is kept.
4. **Given** no PDF has been produced, **When** the user looks at the preview pane, **Then** it shows a plain blank state saying no PDF exists yet.

---

### User Story 2 - See compile status at a glance (Priority: P2)

While writing, the user sees one status indicator that tells them whether the document is untouched, has unsaved/uncompiled edits, is compiling, compiled successfully, or failed.

**Why this priority**: Status is how the user knows what the app is doing; it must exist before real compilation is wired in so later milestones only plug into it.

**Independent Test**: Edit the starter text and trigger the compile action; observe the indicator move through its states with distinct text labels.

**Acceptance Scenarios**:

1. **Given** the starter article is untouched, **When** the writer opens, **Then** the indicator shows "Idle".
2. **Given** the indicator shows "Idle", **When** the user edits the text, **Then** the indicator shows the document has changes (dirty).
3. **Given** any state, **When** the user triggers Compile, **Then** the indicator shows "Compiling" until a result arrives, then "PDF ready" or an error state.
4. **Given** each state, **When** it is displayed, **Then** it is conveyed by text (and optionally an icon), never by color alone.

---

### User Story 3 - Read logs only when needed (Priority: P3)

A collapsible drawer at the bottom holds status and log output. It stays out of the way while writing and opens on its own when a compile fails, so the user sees what went wrong.

**Why this priority**: Logs are essential for understanding failures but must not clutter the writing surface.

**Independent Test**: Toggle the drawer with its button and keyboard shortcut; trigger a failing compile and confirm the drawer opens with a short summary followed by the raw log.

**Acceptance Scenarios**:

1. **Given** the writer has just opened, **When** the user looks at the bottom, **Then** the log drawer is collapsed.
2. **Given** the drawer is collapsed, **When** the user clicks the log toggle or presses Ctrl+L, **Then** the drawer opens; doing it again closes it.
3. **Given** the drawer is collapsed, **When** a compile ends in an error, **Then** the drawer opens automatically and shows a concise summary above the raw log.
4. **Given** the drawer shows a log, **When** the user chooses to copy it, **Then** the full log text is placed on the clipboard.

---

### User Story 4 - Setup only when tools are missing (Priority: P1)

If MiKTeX, latexmk or Strawberry Perl is missing, the user sees the existing compact setup screen instead of the writer. Once setup verifies the tools, the user lands in the writer without restarting.

**Why this priority**: The writer is useless without the tools, and setup must never block users who already have them.

**Independent Test**: Launch once with tools present (writer appears) and once with a tool missing (setup appears); finish setup and confirm the writer appears.

**Acceptance Scenarios**:

1. **Given** at least one required tool is missing, **When** the app starts, **Then** the setup screen is shown, not the writer.
2. **Given** the setup screen is shown, **When** setup completes and verification passes, **Then** the writer opens with the starter article.
3. **Given** the environment check is still running, **When** the app starts, **Then** a short "Checking tools" state is shown rather than flashing the writer or setup screen.

### Edge Cases

- Window at 800x600 with 150% Windows scaling: command strip, both panes and the drawer remain visible and usable; no text overlaps controls.
- Very long lines or a very long document in the editor: the editor scrolls; the layout does not grow beyond the window.
- Log drawer open at the smallest window size: the editor keeps a usable minimum height.
- Compile triggered while already compiling: the compile action is disabled until the current run finishes.
- Environment check itself fails (e.g. unexpected error): the setup screen is shown with the error message rather than a blank window.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST show the writer layout on start when all required tools are verified, and the existing setup screen when any is missing.
- **FR-002**: The writer layout MUST consist of a top command strip, an editor pane on the left, a preview pane on the right, and a collapsible log drawer at the bottom.
- **FR-003**: The editor MUST use a monospace font and load a minimal starter LaTeX article when no file is open.
- **FR-004**: The preview pane MUST show a blank state when no PDF exists, and an error state that points to the logs after a failed compile.
- **FR-005**: The command strip MUST contain only controls that work in this milestone: Compile (text label) and a log drawer toggle. File and settings controls arrive with their own milestones.
- **FR-006**: The app MUST track and display one compile status with states: Idle, Dirty (edited since last compile), Compiling, PDF ready, Error — each with a short text label.
- **FR-007**: Editing the document MUST move the status to Dirty; triggering Compile MUST move it to Compiling and disable Compile until it finishes.
- **FR-008**: Because real compilation is out of scope, the Compile action MUST end with a clearly worded result stating that compilation is not available yet; this result is shown as the error state and its message appears in the log drawer.
- **FR-009**: The log drawer MUST be collapsed on start, toggle via its button and Ctrl+L, open automatically on an error result, show a concise summary before the raw log, and allow copying the log.
- **FR-010**: Every icon-only button MUST have an accessible name and a tooltip; keyboard focus order MUST follow visual order.
- **FR-011**: The layout MUST remain fully usable at an 800x600 window at 100%, 125% and 150% Windows display scaling with no overlapping or clipped controls.
- **FR-012**: No landing page, tutorial, marketing copy or leftover template/demo content may appear anywhere in the app.
- **FR-013**: UI copy MUST follow the short operational style in `docs/DESIGN.md` (e.g. "Compiling", "PDF ready", "Open log").

### Key Entities

- **Document**: the text currently in the editor; starts as the starter article; has a "changed since last compile" flag.
- **Compile status**: one of Idle, Dirty, Compiling, PDF ready, Error, plus an optional short message.
- **Compile log**: a summary line and the raw log text from the most recent compile attempt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With tools present, a user can start typing in the editor within 3 seconds of launch, with no clicks required.
- **SC-002**: At 800x600 and each of 100%, 125% and 150% scaling, a visual check finds zero overlapping or clipped controls.
- **SC-003**: All five compile states can be reached and each is distinguishable by its text label alone (verified in grayscale).
- **SC-004**: 100% of icon-only buttons expose an accessible name and tooltip in an accessibility tree check.
- **SC-005**: On a failing compile, the user reaches the error summary with zero extra clicks.

## Assumptions

- Real compilation, PDF rendering, file open/save, settings and dirty-close warnings are out of scope (milestones M2–M4); this milestone builds the shell they plug into.
- "Dirty" in this milestone means "edited since the last compile attempt"; save-related dirty state arrives with file IO (M2).
- The compile shortcut (Ctrl+B vs F5) is not decided in `docs/DESIGN.md`, so no compile shortcut is added in this milestone; Ctrl+L for logs is included.
- A plain text area is acceptable as the editor (tracker default for MVP); line numbers are not required.
- The starter article is not persisted; edits are lost on close until file IO exists.
- The pane split is fixed (not resizable) in this milestone.
