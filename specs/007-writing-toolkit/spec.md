# Feature Specification: Writing Toolkit

**Feature Branch**: `007-writing-toolkit`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "Unify all of those features": every pending accepted and suggested idea in the `docs/TRACKER.md` Manual Feature Intake, grouped into independently shippable stories. Excluded: spec 003 (live preview, PDF ↔ source sync, errors), release and installer items (F-028…F-036), and declined items (copying PDF text, Zotero/Mendeley).

## User Scenarios & Testing *(mandatory)*

Each story is a separate, shippable increment. Priority follows how often a writer meets the need and its upvotes in other editors.

### User Story 1 - Writing aids (Priority: P1)

While typing, the writer gets suggestions for commands, environments, and their own labels and citation keys. `\begin{…}` closes itself. Misspelled words in the text are underlined while commands are not. A word count is always visible, and a grammar check can be run on demand. Hovering over math shows it rendered. "Tidy" re-indents the file.

**Why this priority**: These aids act on every keystroke; they help new LaTeX users most and cut typos for everyone.

**Independent Test**: In a new project, type `\sec`, accept `\section{}`, type `\begin{itemize}` and see `\end{itemize}` added, cite a key from the project's `.bib` through the suggestion list, see "teh" underlined but not `\textbf`, hover `$\frac{a}{b}$` to see the fraction, and read the word count in the status bar.

**Acceptance Scenarios**:

1. **Given** the cursor after `\` plus letters, **When** suggestions appear, **Then** they include common LaTeX commands and the commands defined in the project, and Enter or Tab inserts the chosen one with placeholders.
2. **Given** the cursor inside `\ref{`, `\eqref{`, `\cite{` (or its variants), **When** suggestions appear, **Then** they list the project's labels or bibliography keys, with the label's context or the entry's title and author.
3. **Given** the user completes `\begin{name}`, **When** they press Enter, **Then** a matching `\end{name}` is inserted below with the cursor indented between. Renaming the begin also renames its end.
4. **Given** the text has misspelled words, **When** shown, **Then** they are underlined and right-clicking offers corrections and "Add to dictionary". Commands, math, labels, keys, URLs and comments are never marked.
5. **Given** the user runs Check grammar, **When** results arrive, **Then** issues are underlined with an explanation and a fix, ignoring LaTeX markup.
6. **Given** any document, **When** text changes, **Then** the status bar shows the word count of the readable text (without commands and math) of the whole project, plus that of the selection when there is one.
7. **Given** the pointer rests on inline or display math, **When** 300 ms pass, **Then** a popup shows it rendered, or an error message when it can't be rendered.
8. **Given** the user runs Tidy, **When** it completes, **Then** environment contents are indented consistently as one undo step, and verbatim-like environments are left untouched.

---

### User Story 2 - Navigation and layout (Priority: P1)

The left side has Files and Outline tabs; the Outline lists sections, figures and tables across the project, and clicking an entry jumps to it. Open files appear as tabs above the editor. Sections and environments fold. Ctrl+Shift+P opens a command palette for every action. Ctrl+Shift+F finds and replaces across the project. Focus mode hides everything but the editor. Vim keys can be turned on.

**Why this priority**: Navigation becomes the bottleneck once documents span chapters and files; tabs (55 👍) and Vim (71 👍) are among the most-asked editor features.

**Independent Test**: In a 3-chapter project, jump to a subsection through the Outline, switch between two files with tabs, fold a section, run "Insert table" from the palette, replace a word in all files, toggle focus mode, and edit with Vim keys turned on.

**Acceptance Scenarios**:

1. **Given** a project, **When** the Outline tab is open, **Then** it shows the hierarchy of parts, chapters and sections, plus figures and tables with their captions, following `\input`/`\include` from the main document, and it updates within 2 seconds of an edit.
2. **Given** several open files, **When** shown, **Then** each has a tab with its name and an unsaved dot; the tabs can be closed, reordered, and switched with Ctrl+Tab.
3. **Given** a section or environment, **When** the user clicks its fold marker or uses the shortcut, **Then** its body collapses to one line until expanded. Folding never changes the text.
4. **Given** Ctrl+Shift+P, **When** the user types, **Then** every ribbon and menu action is listed by name with its shortcut, and Enter runs it.
5. **Given** Ctrl+Shift+F, **When** the user searches, **Then** results across all project text files are grouped by file with line previews. Match case, whole word and regular expression are options. Replace all works across files, each file's change is one undo step, and unsaved open files are included.
6. **Given** focus mode, **When** toggled (F11), **Then** only the editor (and optionally the PDF) is shown, and the same key restores the layout.
7. **Given** Vim keys are on in Settings, **When** editing, **Then** normal, insert and visual modes and the common motions work, and the mode is shown in the status bar. They are off by default.

---

### User Story 3 - Content: citations, images, templates (Priority: P2)

The writer inserts citations from a picker that searches the project's bibliography, and adds a new entry by pasting a DOI. They insert an image from the ribbon or by dropping it on the editor; Lexy copies it into the project and inserts a figure. New projects can start from templates (article, report, letter, CV, beamer).

**Independent Test**: Add an entry by DOI, cite it from the picker, compile and see the reference. Drop a PNG on the editor and see it copied to `figures/` with a figure block inserted. Create a "Letter" project from the gallery and compile it unchanged.

**Acceptance Scenarios**:

1. **Given** a project with `.bib` files, **When** the user opens Insert → Citation, **Then** they can search by author, title, year or key, select one or more entries, and insert `\cite{…}`.
2. **Given** a DOI, **When** the user chooses "Add by DOI", **Then** the entry is fetched, shown for review, and appended to the chosen `.bib` file with a unique key. If no `.bib` exists, Lexy offers to create `references.bib` and add the bibliography commands to the main document.
3. **Given** an image file, **When** inserted from the ribbon or dropped on the editor, **Then** it is copied to the project's image folder (default `figures/`, never overwriting) and a figure environment with width, caption and label placeholders is inserted at the drop point, with `graphicx` added to the preamble if missing.
4. **Given** New project, **When** the user picks a template, **Then** a project is created from it, compiles without edits, and the template's main file becomes the main document.

---

### User Story 4 - Review: notes and version comparison (Priority: P2)

The writer leaves notes on passages ("check this number"), sees them in a side list, and resolves them. Notes can optionally be shown in an exported PDF. They can also compare the current text against any earlier commit or date and see insertions and deletions marked, track-changes style.

**Independent Test**: Add two notes, resolve one, export a PDF with notes and see the open note as a margin comment. Compare against the commit from yesterday and see added text highlighted and removed text struck through.

**Acceptance Scenarios**:

1. **Given** a text selection, **When** the user adds a note, **Then** the passage is highlighted and the note appears in the Notes list with its date. Notes survive edits around them, saving and reopening, and they travel with the project (Git, copying the folder).
2. **Given** a note, **When** the user resolves, reopens or deletes it, **Then** the list and highlights update; resolved notes are hidden by default.
3. **Given** Export PDF with notes, **When** run, **Then** the exported PDF shows open notes as margin comments. The normal PDF never contains notes.
4. **Given** a project with Git history, **When** the user chooses Compare with… a commit or date, **Then** a read-only view shows the current text with insertions highlighted and deletions struck through per file. "Compare with last commit" is one click.

---

### User Story 5 - Files and safety (Priority: P2)

Right-clicking in the sidebar offers Duplicate and Copy/Paste for files and folders. Auto-save can be turned on. Projects without Git get local snapshots that can be restored.

**Independent Test**: Duplicate `chapter1.tex` and get `chapter1 (copy).tex`. Copy a folder and paste it elsewhere in the project. Turn on auto-save, type, wait, and see the file saved. In a project without Git, restore a snapshot from an hour ago.

**Acceptance Scenarios**:

1. **Given** a file or folder, **When** the user duplicates it, **Then** a copy named "<name> (copy)" (numbered if taken) appears beside it. Copy and Paste work within the project, and Paste never overwrites without asking.
2. **Given** auto-save is on (off by default), **When** the user stops typing for the set delay (default 5 seconds), **Then** modified files are saved. A read-only window never auto-saves.
3. **Given** a project without version history, **When** files are saved, **Then** Lexy keeps snapshots of changed text files outside the project (at most one per 10 minutes per file, kept 30 days), and the user can browse and restore them like Git history (restores are uncommitted edits that can be undone).
4. **Given** the project has Git history, **When** files are saved, **Then** no snapshots are made, and the Git history is used instead.

---

### User Story 6 - Settings (Priority: P3)

One Settings screen holds the preferences that the other stories add.

**Acceptance Scenarios**:

1. **Given** File → Settings, **When** opened, **Then** it offers: theme (system, light, dark), editor font size, live preview delay, auto-save and its delay, Vim keys, spell-check language and grammar check on/off, and the image folder name. Changes apply immediately and are remembered.
2. **Given** a setting changes, **When** another Lexy window is open, **Then** it picks up the change on its next focus.

---

### User Story 7 - Export to Word and HTML (Priority: P3)

The writer exports the document as a Word file or a web page to share with people who don't use LaTeX.

**Acceptance Scenarios**:

1. **Given** a project, **When** the user picks Export → Word or Export → HTML, **Then** a file is written beside the main document. It keeps headings, paragraphs, lists, emphasis, tables, images, footnotes and citations. Math becomes Word equations or rendered math in HTML.
2. **Given** content that can't be converted (custom macros, TikZ), **When** exporting, **Then** the export still finishes and a short report lists what was approximated.
3. **Given** the converter isn't available yet, **When** the user exports the first time, **Then** Lexy explains what it needs to download, with its size, and installs it only after consent, with progress.

---

### Edge Cases

- Spell check on non-English or mixed-script text (Bangla from spec 005): words in scripts the dictionary doesn't cover are not marked.
- Labels and keys defined in files that are not open still appear in suggestions; duplicate labels are flagged as warnings.
- Project-wide replace that touches a file open with unsaved edits applies to the open buffer, not the disk.
- Notes on text that is deleted become "detached" and stay in the list with their last text.
- A DOI lookup offline or for an unknown DOI shows "Could not fetch this DOI" and adds nothing.
- Dropping a non-image file on the editor imports it like the sidebar does, without inserting a figure.
- Large projects (500 files, 1,000 pages): outline, search and suggestions stay responsive (SC-005).
- Read-only window: tidy, replace, notes, auto-save and paste are disabled; viewing works.

## Requirements *(mandatory)*

### Functional Requirements

**Writing aids**
- **FR-001**: Lexy MUST suggest LaTeX commands, environments, project-defined commands, labels and bibliography keys in context, with insertion placeholders.
- **FR-002**: Lexy MUST auto-insert the matching `\end{…}` for `\begin{…}`, keep the pair's names in sync, and offer a Tidy command that re-indents as one undo step.
- **FR-003**: Lexy MUST spell check only readable text, offer corrections, and keep a personal dictionary.
- **FR-004**: Lexy MUST offer an on-demand grammar check over readable text only.
- **FR-005**: Lexy MUST show a live word count for the project and the selection, excluding commands and math.
- **FR-006**: Lexy MUST show rendered math on hover.

**Navigation and layout**
- **FR-007**: Lexy MUST show a project outline (sectioning, figures, tables) that follows included files and jumps on click.
- **FR-008**: Lexy MUST show tabs for open files and support folding of sections and environments.
- **FR-009**: Lexy MUST offer a command palette listing every action with its shortcut.
- **FR-010**: Lexy MUST offer project-wide find and replace (case, whole word, regex), including unsaved open files.
- **FR-011**: Lexy MUST offer a focus mode and optional Vim keybindings (off by default).

**Content**
- **FR-012**: Lexy MUST offer a citation picker over the project's bibliography and adding entries by DOI.
- **FR-013**: Lexy MUST insert images from the ribbon or by drop, copying them into the project without overwriting, and add a figure environment.
- **FR-014**: Lexy MUST offer a template gallery (at least article, report, letter, CV, beamer); each template MUST compile unchanged.

**Review**
- **FR-015**: Users MUST be able to add, resolve, reopen and delete notes on passages. Notes MUST persist with the project and MUST NOT appear in the normal PDF.
- **FR-016**: Lexy MUST export a PDF with open notes as margin comments, on request.
- **FR-017**: Lexy MUST show a read-only track-changes comparison against a chosen commit or date.

**Files and safety**
- **FR-018**: Users MUST be able to duplicate, copy and paste files and folders within the project without silent overwrites.
- **FR-019**: Lexy MUST offer optional auto-save with a configurable delay.
- **FR-020**: Projects without Git history MUST get restorable local snapshots stored outside the project folder.

**Settings and export**
- **FR-021**: Lexy MUST provide one Settings screen for the preferences above; changes apply immediately and persist.
- **FR-022**: Lexy MUST export to Word and HTML with a report of approximations; any converter download MUST need consent and show progress.

**Cross-cutting**
- **FR-023**: Every new action MUST be keyboard-reachable and listed in the command palette, follow `docs/DESIGN.md`, and work at 800x600 in light and dark themes.
- **FR-024**: No feature may send document text off the machine without the user turning it on first (grammar check and DOI lookup state what they send).

### Key Entities

- **Suggestion source**: built-in command list, project macros, labels (with context) and bibliography entries (key, title, author, year), all refreshed as files change.
- **Outline entry**: kind (part…subparagraph, figure, table), title or caption, file, line, depth.
- **Note**: anchor (file, text range, quoted text), body, created date, state (open, resolved, detached).
- **Snapshot**: file, time, content; kept outside the project.
- **Template**: name, description, preview, files, main document.
- **Setting**: name, value, default.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Suggestions appear within 100 ms of typing on a 500-file project.
- **SC-002**: A user cites a new paper by DOI in under 30 seconds.
- **SC-003**: Spell check marks no LaTeX command, math, label, key or URL in a 20-page sample, and marks at least 95 % of seeded misspellings.
- **SC-004**: A user jumps to any section of a 300-page project in 2 actions from the Outline.
- **SC-005**: Project-wide search over 500 files returns results within 1 second.
- **SC-006**: Every template compiles on a fresh setup without changes.
- **SC-007**: Exported Word files open in Word with headings, tables, images and equations intact for the bundled templates.
- **SC-008**: No tested sequence of auto-save, snapshots, notes or replace loses text.

## Assumptions

- Each story ships separately in priority order; this spec is planned and built story by story, with each group's features built together and tested once.
- Spell check uses offline dictionaries (English by default; others can be added). It runs locally and needs no account.
- Grammar check uses a LanguageTool-compatible service. It is off until the user turns it on, and Lexy states that the checked text is sent to that server. A self-hosted server URL can be set.
- DOI lookup sends only the DOI to a public metadata service (doi.org content negotiation).
- Notes are stored in one small file inside the project (for example `.lexy/notes.json`), so they travel with Git and folder copies. This is a deliberate exception to "nothing is written into project folders", because notes are the user's content.
- Snapshots live in `%LOCALAPPDATA%\Lexy\Snapshots`, never in the project.
- Word and HTML export rely on a document converter that Lexy installs on first use, with consent and visible progress, like the first-run setup.
- Templates are bundled with Lexy and work offline.
- The three-pane layout reuses the existing sidebar (Files, plus a new Outline tab) and does not change the editor/PDF split.
- Version comparison builds on the Git history from spec 006; projects without Git compare against local snapshots.
