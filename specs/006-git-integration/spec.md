# Feature Specification: Git Version Control for Projects

**Feature Branch**: `006-git-integration`

**Created**: 2026-11-14

**Status**: Draft

**Input**: User description: "Now, I want to add git integration. That will have an option to git init, git commit and git push button. A whole new button, or menu or visual options about git integration." Scope follow-up: "I mainly want single user git commit, git history to keep the project backup and check the diff. So, its also possible by other collaborator to work by cloning the repo. no live collaborator!" Also chosen: Pull / Sync, See changes (diff), History & restore, Publish to GitHub.

**Why**: Git support is one of the most requested features in other editors (TeXstudio "git integration" 24 + 16 + 9 👍 across issues, Overleaf Community Edition "git integration" 58 👍). Lexy projects are already plain folders, so they can be Git repositories without conversion.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn a project into a backed-up history (Priority: P1)

A writer opens the Git tab in the ribbon and clicks "Start version history" (Git init). From then on, whenever they reach a good point, they write a short message ("Finished chapter 2") and click Commit. Each commit is a snapshot of the whole project they can always go back to.

**Why this priority**: Local snapshots are the core value the user asked for (backup and history); everything else builds on them.

**Independent Test**: In a project without Git, click "Start version history", edit the main document, enter a message and commit. The history then shows one commit with that message, and the working state shows no pending changes.

**Acceptance Scenarios**:

1. **Given** a project that is not under version control, **When** the user opens the Git tab, **Then** it explains in one line that the project has no history yet and offers "Start version history".
2. **Given** the user starts version history, **When** it completes, **Then** the project gets an ignore list that keeps Lexy's and LaTeX's generated files (auxiliary files, logs, the exported PDF) out of history, and the first commit "Start Lexy project" is created with all current files.
3. **Given** unsaved edits in open files, **When** the user commits, **Then** Lexy saves all files first, so the commit matches what the user sees.
4. **Given** changes exist, **When** the user enters a message and commits, **Then** all changed, new and deleted project files are recorded in one commit, and the panel shows "Committed: <message>".
5. **Given** no changes since the last commit, **When** the user looks at the Git tab, **Then** Commit is disabled and the panel says "Nothing to commit".
6. **Given** Git is not set up with the user's name and email, **When** they first commit, **Then** Lexy asks for a name and email once and uses them for this and later commits.

---

### User Story 2 - See what changed before committing (Priority: P1)

Before committing, the writer sees a list of changed files (modified, new, deleted) and can open any of them to see the changes line by line: removed lines and added lines, highlighted.

**Why this priority**: The user explicitly wants to "check the diff"; it is how they decide what the commit message says and catch accidental edits.

**Independent Test**: Change two lines in a chapter and delete a file, open the Git tab, see both listed, and open the chapter's changes to see the two lines highlighted as removed and added.

**Acceptance Scenarios**:

1. **Given** changes since the last commit, **When** the Git panel is open, **Then** it lists each changed file with its status (Modified, Added, Deleted, Renamed).
2. **Given** a modified text file, **When** the user selects it, **Then** a side-by-side or inline comparison shows removed and added lines with a few lines of context.
3. **Given** a changed binary file (an image or PDF), **When** selected, **Then** the panel says the file changed and shows its size before and after, without a line comparison.
4. **Given** the list is open, **When** files change on disk or are saved, **Then** the list updates within 2 seconds.

---

### User Story 3 - Browse history and restore (Priority: P2)

The writer opens History and sees past commits, newest first, with message, date and changed files. They can open any file as it was in that commit, compare it with today's version, and restore it, or restore the whole project to that commit.

**Why this priority**: History is half of "backup"; restoring is what makes the backup useful. It comes after committing and diffing because those create the history.

**Independent Test**: Make three commits, open History, select the first commit, view `main.tex` as it was, restore it, and check that the editor shows the old text and the change appears as an uncommitted change (nothing is lost).

**Acceptance Scenarios**:

1. **Given** a project with commits, **When** the user opens History, **Then** commits are listed newest first with message, author, relative date and the number of changed files.
2. **Given** a selected commit, **When** the user picks a file in it, **Then** they can view it as it was and compare it with the current version.
3. **Given** a selected commit, **When** the user chooses "Restore this file", **Then** the file's content becomes the old version as an uncommitted change, and an open copy in the editor reloads (unsaved edits in that file require confirmation first).
4. **Given** a selected commit, **When** the user chooses "Restore whole project to this point", **Then** Lexy first asks for confirmation, then makes all files match that commit as uncommitted changes. Later commits stay in history, so the restore itself can be undone.
5. **Given** a long history, **When** the user scrolls, **Then** older commits load progressively without blocking the editor.

---

### User Story 4 - Back up online and let others clone (Priority: P2)

The writer clicks "Publish to GitHub". Lexy creates a private repository in their GitHub account (after they sign in through the browser the first time) and pushes the history. Later, Push uploads new commits. Alternatively, they paste the URL of any existing remote repository (GitHub, GitLab, a university server). A collaborator can clone that repository and work on it in any editor, including Lexy.

**Why this priority**: The user asked for Push and Publish to GitHub; it turns local history into an off-machine backup and enables clone-based collaboration.

**Independent Test**: Publish a project with two commits to GitHub; the new private repository shows both commits; make a third commit and Push; it appears online.

**Acceptance Scenarios**:

1. **Given** a project with history and no remote, **When** the user clicks "Publish to GitHub", **Then** they choose a repository name (default: project folder name) and visibility (private by default), sign in if needed, and the repository is created and pushed. The panel then shows the repository link.
2. **Given** a project with no remote, **When** the user chooses "Connect to existing repository" and pastes a URL, **Then** Lexy checks it can reach it and sets it as the upload destination.
3. **Given** local commits not yet uploaded, **When** the panel is open, **Then** it shows "N commits to push" and Push is enabled.
4. **Given** the user pushes, **When** sign-in is required, **Then** the standard Windows/Git sign-in window appears; Lexy never asks for or stores a password itself.
5. **Given** the remote has commits Lexy doesn't have (a collaborator pushed), **When** the user pushes, **Then** Lexy explains "Someone else pushed changes. Pull first." and offers Pull.
6. **Given** no network, **When** pushing, **Then** the panel says it could not reach the server and the local commits stay safe.

---

### User Story 5 - Get a collaborator's changes (Priority: P3)

A collaborator cloned the repository, edited a chapter and pushed. The writer clicks Pull (or "Sync": pull, then push). Lexy brings in the changes, and open files reload. If both edited the same lines, Lexy shows which files conflict and lets the writer pick "Keep mine", "Keep theirs", or edit the file to resolve, then commit.

**Why this priority**: Needed for clone-based collaboration and for Push after someone else pushed; less frequent for a mostly single-user workflow.

**Independent Test**: Push from a second clone, Pull in Lexy, and see the new text in the editor. Repeat with a conflicting edit and resolve it with "Keep theirs".

**Acceptance Scenarios**:

1. **Given** uncommitted changes, **When** the user pulls, **Then** Lexy asks to commit them first, so no edits are overwritten.
2. **Given** a clean project and new remote commits, **When** the user pulls, **Then** the changes are applied, open files reload, and the panel says "Pulled N commits".
3. **Given** conflicting edits, **When** pull stops with conflicts, **Then** conflicting files are marked in the sidebar and the Git panel, and the user can choose Keep mine / Keep theirs per file, or edit the file and mark it resolved. Then they commit.
4. **Given** the user wants to back out, **When** conflicts are shown, **Then** "Cancel pull" returns the project to the state before pulling.

---

### Edge Cases

- Git is not installed: the Git tab says "Git for Windows is needed for version history" with a link to its download page; nothing else in Lexy is affected.
- The project folder is inside another repository (for example the whole Documents folder is a repo): Lexy shows that repository's status for this project's files only and says so ("Part of the repository at D:\…").
- The project is opened read-only (second window): Git actions that change files are disabled; History and diffs stay viewable.
- Very large files (over 50 MB, for example datasets or videos): before committing, Lexy warns that hosting services may reject them and offers to add them to the ignore list.
- A file with a non-Latin name (Bangla, from spec 005) appears and commits correctly in all views.
- Line endings: Lexy does not change line endings; the diff ignores line-ending-only differences so a file isn't shown as fully changed.
- The remote URL needs a VPN or is unreachable: the error names the server and says the local history is unaffected.
- The user deletes the hidden history folder from Explorer: the Git tab returns to "no history yet".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Lexy MUST show a Git area (ribbon tab plus a panel) for the open project, with its state: no history, clean, N changes, N commits to push or pull, conflicts.
- **FR-002**: Users MUST be able to start version history for a project, which creates an ignore list for generated files (at least auxiliary, log, synctex and the exported PDF beside the main document) and a first commit.
- **FR-003**: Users MUST be able to commit all changes with a message. Lexy MUST save all open files first; empty messages are not allowed.
- **FR-004**: Lexy MUST list changed files with their status and show a line-by-line comparison for text files.
- **FR-005**: Users MUST be able to browse history, view any file at any commit, compare it with the current version, and restore a file or the whole project as uncommitted changes, after confirmation.
- **FR-006**: Users MUST be able to publish to a new private GitHub repository, or connect an existing remote by URL.
- **FR-007**: Users MUST be able to push and pull; Sync MUST pull then push.
- **FR-008**: Lexy MUST never ask for, display or store passwords or tokens itself; sign-in uses the system Git sign-in and the browser.
- **FR-009**: Pull MUST refuse to run over uncommitted changes, and conflicts MUST be resolvable per file (Keep mine, Keep theirs, edit and mark resolved), or the pull cancelled.
- **FR-010**: The Git status MUST update within 2 seconds of a save, outside change or Git action.
- **FR-011**: Every Git action MUST show progress while running and a plain-language result or error; long actions (push, pull, publish) MUST not freeze the editor.
- **FR-012**: The sidebar MUST mark files that changed since the last commit.
- **FR-013**: Git actions MUST only operate on the open project folder (or the repository that contains it), never on other folders.
- **FR-014**: Every action MUST be reachable by keyboard; commit MUST have a shortcut.

### Key Entities

- **Repository state**: whether the project has history, the current branch, the remote (if any), counts of changes, commits to push and commits to pull, conflict state.
- **Change**: a file with a status (modified, added, deleted, renamed, conflicted) and, for text files, its line differences.
- **Commit**: message, author, date, list of changed files; can be viewed, compared and restored from.
- **Remote**: name and URL of the upload destination; the GitHub repository link after Publish.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user turns a project into a versioned project and makes a commit in under 1 minute without documentation.
- **SC-002**: A user publishes a project to a new private GitHub repository in under 2 minutes, including the first sign-in.
- **SC-003**: For a project with 1,000 commits, the history list shows the newest 50 within 1 second.
- **SC-004**: The change list and diffs for a 200-file project appear within 1 second of opening the Git panel.
- **SC-005**: No edit is lost in any tested sequence of commit, restore, pull and conflict resolution (restores and pulls are always undoable or confirmed).
- **SC-006**: A collaborator who clones the published repository can compile the project in Lexy with no files missing except those deliberately ignored.

## Assumptions

- Single user, history and backup first; collaboration only by cloning, pulling and pushing. No live editing, no branches UI in this version (Lexy works on the current branch; a branch made outside Lexy is shown by name only).
- Git for Windows is installed by the user (it is on the dev machine, along with GitHub CLI). Lexy does not install Git silently; it links to the official download.
- Sign-in uses Git's standard Windows credential handling and the browser; for Publish to GitHub, Lexy may use the GitHub sign-in already present on the machine (GitHub CLI) or a browser sign-in. No token is stored by Lexy.
- Private repositories are the default for Publish because drafts are usually private.
- The ignore list keeps the exported PDF out of history by default (it is regenerated from the sources); users can remove that line if they want PDFs versioned.
- Lexy's build folder lives outside the project, so build files never appear in Git.
- Other picks from the research round are logged in TRACKER intake, not in this feature: grammar check, Vim keybindings, editor tabs, section folding, comments/notes, hover math preview, auto-close and tidy, compare versions (partly covered by US2/US3 here), copy/duplicate files.
