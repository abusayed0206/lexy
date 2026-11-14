# Feature Specification: Project Workspace

**Feature Branch**: `004-project-workspace`

**Created**: 2026-11-13

**Status**: Draft

**Input**: User description: "now, add project setup style system instead of file system! user will open a folder or a project folder will open on defult folde. is it viable feature, if it is, add it. and suggest me more fatures, u revamp etc. i want a complete system!"

**Viability**: Yes. Lexy already gives every new document its own folder (`Documents\Lexy\Name\Name.tex`, F-044), and compiles already find files beside the document. A project is that folder, made visible and editable as a whole. This feature replaces the single-file model; it does not add a second one.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start on a project home and open a project (Priority: P1)

When Lexy starts (after setup), the writer sees a Project Home: their projects in the default folder (`Documents\Lexy`), most recent first, plus "New project" and "Open folder…". Clicking a project opens it. "Open folder…" opens any folder on disk as a project.

**Why this priority**: This is the entry point that replaces "open a file"; nothing else in the project system works without it.

**Independent Test**: With three project folders in `Documents\Lexy`, launch Lexy, see all three listed, click one, and land in the editor with its main document open.

**Acceptance Scenarios**:

1. **Given** `Documents\Lexy` contains project folders, **When** Lexy starts, **Then** Project Home lists each folder with its name and last-modified date, most recent first, and recently opened projects from other locations appear in the same list marked with their location.
2. **Given** Project Home is shown, **When** the user clicks "New project" and types a name, **Then** Lexy creates `Documents\Lexy\<Name>\` containing `<Name>.tex` with the starter document and opens it; if the name is taken it uses `<Name> (2)`.
3. **Given** Project Home is shown, **When** the user picks any folder with "Open folder…", **Then** that folder opens as a project and is added to the recent list.
4. **Given** a project was open when Lexy last closed, **When** Lexy starts again, **Then** it reopens that project directly (Project Home stays one click away via File → Project Home).
5. **Given** a recent project's folder no longer exists, **When** Project Home is shown, **Then** that entry is marked "Missing" with a "Remove from list" action and cannot be opened.

---

### User Story 2 - Work with the project's files in a sidebar (Priority: P1)

Inside a project, a sidebar shows the folder's files and subfolders. The writer clicks any `.tex`, `.bib`, `.cls`, `.sty` or `.txt` file to edit it. They can create, rename and delete files and folders, and drag files from Explorer into the sidebar to copy them in (images, `.bib` files, chapters).

**Why this priority**: Multi-file documents (chapters, bibliographies, figures) are why users want projects at all.

**Independent Test**: Open a project, create `chapters\intro.tex`, write text in it, add `\input{chapters/intro}` to the main file, compile, and see the intro in the PDF.

**Acceptance Scenarios**:

1. **Given** an open project, **When** the user clicks a text file in the sidebar, **Then** it opens in the editor and the sidebar marks it as the current file.
2. **Given** a file has unsaved edits, **When** the user switches to another file, **Then** the edits are kept (not lost, not saved), the file shows the unsaved dot in the sidebar, and switching back restores the text, cursor and undo history.
3. **Given** the user clicks a non-text file (image, PDF), **When** it opens, **Then** Lexy shows it with the default Windows app and does not load it into the editor.
4. **Given** the user chooses New file, New folder, Rename or Delete from the sidebar, **When** they confirm, **Then** the change happens on disk; Delete moves items to the Recycle Bin and asks first.
5. **Given** the user drags files from Explorer onto a sidebar folder, **When** they drop, **Then** the files are copied into that folder; a name clash asks "Replace" / "Keep both" / "Skip".
6. **Given** files change on disk outside Lexy, **When** the change happens, **Then** the sidebar updates within 2 seconds; if an open file with no unsaved edits changed, the editor reloads it; if it has unsaved edits, Lexy shows a notice offering "Reload" or "Keep mine".

---

### User Story 3 - Compile the project from any file (Priority: P1)

The project has one main document (the one with `\documentclass`). Compile, F5 and live preview always compile the main document, whichever file is open, using the current text of every open file including unsaved edits.

**Why this priority**: Without this, editing a chapter file would try to compile the chapter on its own and fail.

**Independent Test**: Open `chapters\intro.tex`, change a sentence without saving, wait for live preview, and see the change in the full document's PDF.

**Acceptance Scenarios**:

1. **Given** a project with exactly one `.tex` file in the top folder containing `\documentclass`, **When** it opens, **Then** that file becomes the main document, marked with a "Main" badge in the sidebar.
2. **Given** several candidate main files, or none at the top level, **When** the project opens, **Then** Lexy asks the user to choose the main document once and remembers the choice for that project; the user can change it later with "Set as main document" in the sidebar.
3. **Given** a sub-file is open, **When** the user presses F5, **Then** all files with unsaved edits are saved and the main document is compiled.
4. **Given** live preview is on and a sub-file has unsaved edits, **When** the user pauses typing, **Then** the PDF reflects those edits without saving any file.
5. **Given** the main document is deleted or renamed outside Lexy, **When** the next compile starts, **Then** Lexy asks the user to pick a new main document instead of failing silently.

---

### User Story 4 - Close and switch projects safely (Priority: P2)

Closing the window, switching projects or returning to Project Home never loses work, and the PDF ends up in the project folder.

**Why this priority**: The current single-file safety rules (unsaved guard, PDF export on close) must carry over; it is a regression risk rather than new value.

**Independent Test**: Edit two files without saving, close the window, and get one prompt that lists both files with Save all / Don't save / Cancel.

**Acceptance Scenarios**:

1. **Given** unsaved edits in one or more files, **When** the user closes the window, switches project or goes to Project Home, **Then** one prompt lists the affected files with "Save all", "Don't save" and "Cancel".
2. **Given** a project closes, **When** the main document has been compiled, **Then** the PDF is written beside the main document, as today (F-045).
3. **Given** an unsaved, untitled document exists from earlier versions of Lexy, **When** the user saves it, **Then** it becomes a new project folder (existing F-044 behaviour).

---

### Edge Cases

- The user opens a very large folder (a drive root, their whole home folder): if it holds more than 5,000 files, Lexy warns "This folder is large. Open anyway?" before listing it, and the sidebar never blocks typing while it loads.
- Hidden and build-clutter files (`.aux`, `.log`, `.fls`, `.fdb_latexmk`, `.synctex.gz`, `.git`) are hidden in the sidebar by default.
- Files that are not UTF-8 or larger than 10 MiB open with a short notice instead of loading (same limits as today).
- A file or folder name with characters Windows forbids is rejected with a plain message.
- The project folder itself is deleted or the drive disconnects while open: Lexy keeps the open text in memory, shows "Project folder is missing", and offers "Save as new project".
- Two Lexy windows opening the same project: the second one opens read-only with a notice.
- Opening a single `.tex` file (File → Open, or launching Lexy with a file): its folder opens as the project, and that file is opened and suggested as the main document.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Lexy MUST show Project Home on start when no project was open at last exit, and reopen the last project otherwise.
- **FR-002**: Project Home MUST list projects found directly inside the default folder plus up to 20 recently opened projects from other locations, newest first, deduplicated.
- **FR-003**: Users MUST be able to create a new project by name in the default folder; Lexy MUST never overwrite an existing folder.
- **FR-004**: Users MUST be able to open any folder on disk as a project.
- **FR-005**: An open project MUST show a sidebar with its files and folders, hiding build and hidden files by default, with a toggle to show all.
- **FR-006**: Users MUST be able to create, rename and delete files and folders, and copy files in by drag-and-drop; deletion MUST go to the Recycle Bin after confirmation.
- **FR-007**: Lexy MUST only read, write, rename or delete paths inside the open project folder (plus its own build folder); any path that resolves outside it MUST be refused.
- **FR-008**: Each open text file MUST keep its own text, unsaved state, cursor and undo history while the project is open.
- **FR-009**: Each project MUST have exactly one main document; Lexy MUST detect it automatically when unambiguous, ask otherwise, and remember the choice per project without adding files to the user's folder.
- **FR-010**: Compile, F5 and live preview MUST compile the main document using the current in-editor text of all open files, without writing unsaved edits to the user's files.
- **FR-011**: Ctrl+S MUST save all modified files in the project (one save action for non-experts); Ctrl+Shift+S keeps "Save as" and saves the current file under a new name inside the project. Explicit Compile/F5 MUST save all modified files first.
- **FR-012**: The sidebar MUST reflect changes made outside Lexy within 2 seconds, and Lexy MUST never silently discard unsaved edits when a file changes on disk.
- **FR-013**: Closing, switching project or returning to Project Home MUST show one combined unsaved-changes prompt when any file is modified.
- **FR-014**: On project close the PDF MUST be exported beside the main document (F-045 behaviour).
- **FR-015**: The sidebar MUST be collapsible (with a keyboard shortcut) and resizable, and the layout MUST stay usable at 800x600 with the sidebar open.
- **FR-016**: Every sidebar action MUST be reachable by keyboard (arrow keys to move, Enter to open, F2 rename, Delete to delete) and from a right-click menu.
- **FR-017**: Ribbon document settings (font, size, paper, margins) MUST apply to the main document, whichever file is open.
- **FR-018**: The existing single-document projects in `Documents\Lexy` MUST open as projects with no migration step.

### Key Entities

- **Project**: a folder on disk. Attributes: path, display name (folder name), main document, last opened time. Nothing is written into the folder to mark it as a project.
- **Main document**: the `.tex` file compiled for the project; one per project.
- **Open file**: a text file loaded in the editor during this session, with its text, saved/unsaved state, cursor and undo history.
- **Recent projects list**: per-user list (max 20) of projects opened, with their last-opened time; stored with Lexy's own app data.
- **Default folder**: `Documents\Lexy` (F-042), where new projects are created and scanned for Project Home.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From launch, a returning user is editing their last project in one step (zero clicks), and any other recent project in two clicks or fewer.
- **SC-002**: A new user can create a project, add a chapter file, include it and see it in the PDF in under 3 minutes without documentation.
- **SC-003**: A project with 200 files and 20 `.tex` files opens and shows its sidebar in under 1 second.
- **SC-004**: Switching between open files takes under 100 ms and never loses text, cursor position or undo history.
- **SC-005**: No unsaved edit is lost in any tested sequence of file switching, external changes, project switching and window closing.
- **SC-006**: Every project created by earlier Lexy versions opens without any manual step.

## Assumptions

- "Project" means a plain folder; no project file or hidden folder is added, so projects stay compatible with other LaTeX editors and with Overleaf/Git.
- The main-document choice and recent list live in Lexy's per-user app data, keyed by folder path.
- One project per window; multi-window and editor tabs (several files side by side) are out of scope for v1. The sidebar is how users switch files.
- Non-text files are opened with the default Windows app; an in-app image viewer is out of scope.
- The Recycle Bin is available on the user's drive; on drives without one, Lexy asks to delete permanently.
- This feature unblocks the `\input` jump left out of `specs/003-pdf-source-sync`: once Lexy can open several files, jumps into sub-files can switch to that file.
- Recent files (F-014) is replaced by the recent projects list.
