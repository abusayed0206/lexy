# Data Model: Writing Toolkit

TS types mirror Rust serde structs (camelCase) where both sides exist; change both together.

## ProjectText (Rust → TS)

| Field | Type | Rule |
|---|---|---|
| path | string | project-relative, `/` separators |
| text | string | UTF-8; files over 2 MiB or not UTF-8 are omitted |
| modified | number | ms since epoch, for cache invalidation |

`project_texts` returns at most 2,000 entries; `truncated: true` in the response when more exist.

## ProjectIndex (TS, derived)

| Field | Type | Rule |
|---|---|---|
| macros | `{ name, args, file, line }[]` | from `\newcommand`, `\renewcommand`, `\DeclareMathOperator`, `\def` |
| labels | `{ key, file, line, context }[]` | `context` = the heading/caption/line around `\label`; duplicates flagged |
| bibEntries | `{ key, type, title, author, year, file, line }[]` | from `@type{key, …}` in `.bib` files |
| outline | `OutlineEntry[]` | in document order following includes from the main document |
| documentFiles | string[] | main document plus every file it includes, in document order (word count in US1 sums these) |

Rebuilt from `ProjectText[]` + buffers; recomputed per changed file only.

## OutlineEntry

| Field | Type | Rule |
|---|---|---|
| kind | `"part" \| "chapter" \| "section" \| "subsection" \| "subsubsection" \| "paragraph" \| "subparagraph" \| "figure" \| "table"` | |
| title | string | heading text or caption, commands stripped; "(no caption)" if none |
| file / line | string / number | 1-based line |
| depth | number | 0 = part … 6 = subparagraph; figures/tables take their section's depth + 1 |

## Completion item (TS)

`label`, `detail` (signature, label context, or "Author · Year"), `type` (`command | environment | label | citation | macro`), `apply` (snippet with `${}` placeholders).

## SpellIssue / GrammarIssue

| Entity | Fields |
|---|---|
| SpellIssue (TS) | `from`, `to`, `word`; suggestions fetched lazily on right-click |
| GrammarIssue (Rust → TS) | `offset`, `length`, `message`, `replacements: string[]` (≤ 5), `rule` |

## Note (`.lexy/notes.json`)

```json
{ "version": 1, "notes": [ { "id": "n_1731571200000", "file": "chapters/intro.tex", "from": 120, "to": 156,
  "quote": "the number of samples", "body": "check this number", "created": "2026-11-14T10:00:00Z",
  "state": "open" } ] }
```

| Field | Rule |
|---|---|
| id | unique; `n_` + creation ms |
| file | project-relative |
| from / to | character offsets in the file as last saved; `from < to` |
| quote | ≤ 200 chars of the anchored text, used to re-anchor |
| body | 1–2,000 chars |
| state | `open` → `resolved` → `open` (reopen); any → `detached` when the quote can't be found; delete removes it |

Written only by explicit note actions (and saving files with notes, to store updated offsets). Read-only windows don't write.

## Snapshot

| Field | Type | Rule |
|---|---|---|
| file | string | project-relative |
| time | number | ms since epoch (file name `<time>.txt`) |
| size | number | bytes |

Stored under `%LOCALAPPDATA%\Lexy\Snapshots\<hash(root)>\<rel>\`; at most one per file per 10 minutes; pruned after 30 days; only when the project has no Git repository.

## Template

`id` (`article | report | letter | cv | beamer`), `name`, `description`, `mainFile` (`<Name>.tex` after creation), `files` (bundled). Each compiles unchanged (SC-006).

## Settings (`%LOCALAPPDATA%\Lexy\settings.json`)

| Key | Type | Default |
|---|---|---|
| theme | `"system" \| "light" \| "dark"` | `"system"` |
| editorFontSize | number 10–24 | 14 |
| livePreviewDelayMs | number 300–5000 | 1000 |
| autoSave | boolean | false |
| autoSaveDelayMs | number 1000–60000 | 5000 |
| vim | boolean | false |
| spellCheck | boolean | true |
| spellLanguage | string | `"en_US"` |
| grammarCheck | boolean | false |
| grammarServer | string (https URL) | `"https://api.languagetool.org"` |
| imageFolder | string (valid folder name) | `"figures"` |
| hidePdfInFocus | boolean | false |

Unknown keys are kept; invalid values fall back to defaults. Other windows reload on focus (US6.2).

## Action (TS)

`id` (stable, e.g. `insert.citation`), `title` (sentence case), `group` (ribbon tab), `shortcut?`, `run()`, `enabled?()`.

## ExportReport (Rust → TS)

`output` (project-relative path written), `warnings: string[]` (Pandoc stderr lines, ≤ 50).
