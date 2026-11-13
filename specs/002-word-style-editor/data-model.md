# Data Model: Word-Style Writing Experience

Document settings are stored in the `.tex` text. UI preferences are stored in `localStorage`. Everything else is in-memory.

## DocumentSettings (parsed from / written to the `.tex` source — `src/latex/settings.ts`)

| Field | Type | Default | Validation |
| --- | --- | --- | --- |
| `font` | `{ kind: "builtin"; id: BuiltinFontId } \| { kind: "system"; family: string }` | `builtin / latin-modern` | `id` ∈ table in research R3; `family` matches `^[A-Za-z0-9 _.'&+-]{1,64}$` |
| `size` | `10 \| 11 \| 12` | `10` (LaTeX default when no option) | Must be one of the three |
| `paper` | `"a4" \| "letter"` | `"a4"` | — |
| `orientation` | `"portrait" \| "landscape"` | `"portrait"` | — |
| `margins` | `{ top, bottom, left, right }` (cm) | `2.54` each (Word "Normal") | Each 0.5 ≤ v ≤ 6, rounded to 0.01 |
| `engine` (derived) | `"pdflatex" \| "xelatex"` | from `font.kind` | Not stored separately; written as the line-1 marker only for `xelatex` |
| `managed` (derived) | `boolean` | `false` until Lexy writes the block | `true` when the block markers are present |

**Margin presets** (Word): Normal 2.54 all; Narrow 1.27 all; Moderate 2.54 top/bottom, 1.91 left/right; Wide 2.54 top/bottom, 5.08 left/right.

**Operations** (all pure, `string → string` or `string → DocumentSettings`):
- `parseSettings(source)` → `DocumentSettings` (defaults where absent; never throws).
- `applySettings(source, settings)` → new source: rewrites or creates the block after `\documentclass`, sets the class size option (keeping other options), and adds or removes the engine marker. Returns the source unchanged if there is no `\documentclass`, and the caller shows "No \documentclass found".
- `conflicts(source)` → list of user lines outside the block that load `geometry` or a known font package.
- Round-trip invariant: `parseSettings(applySettings(s, x)) == x`, and `applySettings(applySettings(s, x), x) == applySettings(s, x)`.

## LivePreviewState (`src/livePreview.ts`)

| Field | Type | Notes |
| --- | --- | --- |
| `enabled` | boolean | From `localStorage["lexy.livePreview"]`, default `true` |
| `phase` | `"idle" \| "waiting" \| "running"` | `waiting` = debounce timer pending |
| `queued` | boolean | A newer text arrived while running |
| `lastError` | string \| null | One-line summary of the last failed live compile |

### Transitions

| From | Event | To | Effect |
| --- | --- | --- | --- |
| idle | `edit` | waiting | start 1000 ms timer |
| waiting | `edit` | waiting | restart timer |
| waiting | `timer` | running | compile latest text |
| running | `edit` | running | `queued = true` (no timer) |
| running | `done` (queued) | running | `queued = false`; compile latest text |
| running | `done` (not queued) | idle | — |
| any | `disable` | idle | cancel timer; a running compile finishes but its result still shows |
| any | explicit Compile | (unchanged scheduler) | explicit compile waits for the running one via the backend lock |

## PdfViewState (`src/PdfView.tsx`)

| Field | Type | Notes |
| --- | --- | --- |
| `bytes` | Uint8Array \| null | Latest good PDF |
| `scrollRatio` | number | `scrollTop / scrollHeight`, captured before swap and restored after |
| `rendering` | boolean | New pages drawing offscreen; old pages stay visible |

## EquationDraft (`src/ribbon/EquationDialog.tsx`, `src/latex/equations.ts`)

| Field | Type | Validation |
| --- | --- | --- |
| `tex` | string | Any; empty disables Insert |
| `mode` | `"inline" \| "display"` | — |
| `render` | `{ ok: true; html } \| { ok: false; message }` | From KaTeX; `ok:false` still allows Insert |
| `editing` | `{ from, to, mode } \| null` | From `findEquationAt`; Insert replaces `from..to` |

## TableSpec (`src/latex/tables.ts`)

| Field | Type | Default | Validation |
| --- | --- | --- | --- |
| `rows` | int | 2 | 1–50 (grid: 1–8) |
| `cols` | int | 2 | 1–20 (grid: 1–10) |
| `header` | boolean | true | — |
| `borders` | boolean | true | — |
| `align` | `"l" \| "c" \| "r"` | `"l"` | — |
| `caption` | string | `""` | Escaped for LaTeX specials (`& % $ # _ { } ~ ^ \`) |

## UI preferences (`localStorage`, best-effort, wrapped in try/catch)

| Key | Value |
| --- | --- |
| `lexy.livePreview` | `"1"` / `"0"` |
| `lexy.ribbonTab` | `home \| insert \| layout \| view \| file` |
| `lexy.split` | existing |
