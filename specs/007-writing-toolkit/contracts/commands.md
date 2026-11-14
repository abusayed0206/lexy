# Contract: Tauri commands (feature 007)

All commands are `async` with blocking work in `spawn_blocking`. Project file commands take project-relative paths and go through `resolve_in_project`; errors are `ProjectError { kind, message }` unless noted. Mutating commands refuse read-only windows (`kind: "readOnly"`). TS wrappers: `src/projects.ts` (files), `src/compile.ts` (export/notes PDF), `src/settings.ts`, `src/writingAids.ts` (spell, grammar, DOI).

## Batch 0

### `project_texts { paths?: string[] } -> { files: ProjectText[], truncated: boolean }`

- No `paths`: every text file (`.tex .bib .sty .cls .bst .txt .md`) under the open root, skipping dot-folders, build clutter (same filter as the watcher) and files > 2 MiB or not UTF-8; at most 2,000 files.
- With `paths`: only those (missing ones are omitted, so the caller drops them).

### `get_settings -> Settings` / `set_settings { settings: Settings } -> Settings`

`%LOCALAPPDATA%\Lexy\settings.json`, written atomically. Returns the stored value after validation (invalid fields → defaults; unknown keys kept). Errors are strings.

## Batch A (US1)

### `spell_check { lang: string, words: string[] } -> string[]`

Returns the subset of `words` (≤ 2,000 unique per call) that are misspelled and not in the personal dictionary. Unknown `lang` → error `Dictionary "<lang>" is not installed`.

### `spell_suggest { lang: string, word: string } -> string[]` (≤ 8)

### `dictionary_add { word: string } -> ()`

Appends to `%LOCALAPPDATA%\Lexy\dictionary.txt` (deduplicated). The dictionary is loaded once into managed state (`SpellState`).

### `grammar_check { server: string, lang: string, annotated: AnnotatedPart[] } -> GrammarIssue[]`

`AnnotatedPart = { text: string } | { markup: string }`. Refuses when `settings.grammarCheck` is false (error `Grammar check is off`). `server` must be `https://`; body ≤ 20 KB; 15 s timeout; response capped at 1 MB. Offsets are in the concatenated text+markup string.

## Batch C (US5)

### `copy_entry { from: string, toDir: string } -> string`

Copies a file or folder into `toDir`; the copy is named `<stem> (copy)<ext>`, then `(copy 2)`… if taken (never overwrites); returns the new relative path. Copying a folder into itself → `kind: "invalidName"`. Lexy's own write (watcher ignores it).

### Snapshots

- Taken inside `write_file` (no new call) when the project has no Git repository.
- `list_snapshots { file: string } -> Snapshot[]` (newest first)
- `read_snapshot { file: string, time: number } -> string`

## Batch D (US3)

### `fetch_doi { doi: string } -> string`

Accepts `10.xxxx/…` or a `https://doi.org/…` URL; sends only the DOI to `https://doi.org/` with `Accept: application/x-bibtex`; returns BibTeX text. Errors: `Could not fetch this DOI` (offline, 404, non-BibTeX response). 10 s timeout, 64 KB cap.

### Images

Existing `import_files { sources, targetDir, onConflict: "keepBoth" }` into `settings.imageFolder` (created with `create_folder` if missing). No new command.

### Templates

Existing `create_project { name, starter }`; the starter is the template text from `src/templates/`. No new command.

## Batch E (US4)

### Notes

`read_file` / `write_file` on `.lexy/notes.json` (the `.lexy` folder is created by `create_folder` on first note). No new command; `is_editable` must accept `.json` under `.lexy/`.

### `export_pdf_with_notes { main: string, buffers: Buffer[] } -> string`

Same as `compile_project` but with its own build key (`hash(main) + "-notes"`), never touching the shown preview; on success copies the PDF to `<main stem> (notes).pdf` beside the main document and returns its relative path. `buffers` already contain the injected `\todo{}` notes and `\usepackage{todonotes}`.

## Batch G (US7)

### `converter_status -> { installed: boolean, version?: string, downloadBytes: number }`

### `install_converter -> ()`

Downloads the pinned Pandoc ZIP (version and SHA-256 constants in `export.rs`) into `%LOCALAPPDATA%\Lexy\Tools\Pandoc` with `converter-progress` events (`{ state: running|done|error, bytesDone, bytesTotal, detail }`), verifies the hash, unzips (path-traversal-safe, reuse `setup.rs` helpers). Only called after the consent dialog.

### `export_document { main: string, format: "docx" | "html" } -> ExportReport`

Runs Pandoc from the project root on the saved main document (the Writer saves all first) with `--resource-path` = project root, `--citeproc` when a `.bib` is referenced, `--mathml` for HTML, 120 s timeout, hidden console; writes `<stem>.docx` / `<stem>.html` beside the main document; stderr lines → `warnings`. Non-zero exit with no output file → error with the last stderr lines.
