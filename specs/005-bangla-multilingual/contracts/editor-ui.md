# Contract: Editor and status UI

## Editor (`src/Editor.tsx`, `src/indicKeys.ts`, `src/App.css`)

- Right-to-left lines: `EditorView.perLineTextDirection.of(true)` plus `dir="auto"` on every visible line (a view plugin). Each line's direction follows its first strong character, so an Arabic line reads right to left while LaTeX-only lines stay left to right. (perLineTextDirection only reads the direction, so the `dir` attribute is required; research R8.)
- `--font-mono`: `"Cascadia Mono", "Cascadia Code", Consolas, "Nirmala UI", "Segoe UI", "Microsoft YaHei", "Yu Gothic", "Malgun Gothic", ui-monospace, monospace`. Latin text keeps the monospace font; other scripts fall back to fonts that ship with Windows.
- Indic scripts (`src/indicKeys.ts`, high-precedence keymap, only next to letters in U+0900–U+0DFF on left-to-right lines):
  - Left/Right (and Shift+Left/Right) step over a whole letter as the browser's `Intl.Segmenter` sees it: "ক্ষে" and "ত্র" are one step each, and the cursor never lands inside a conjunct.
  - Backspace removes one code point, like Windows: ক্ষ → ক্, আমি → আম.
  - Everywhere else, CodeMirror's own commands run unchanged.
- No input handling changes: Windows keyboard layouts and IMEs (for example Avro) go through CodeMirror's composition support.

## Status (`src/Writer.tsx` → `src/Ribbon.tsx`)

- The status pill tooltip shows the engine for the last result: `XeLaTeX · PDF ready`, `pdfLaTeX · <error summary>` (`statusDetail` in Writer.tsx). Before any compile there is no tooltip. Engine names are displayed as pdfLaTeX, XeLaTeX, LuaLaTeX.
- Summaries: `Font "Kalpurus" not found`, `Package "latexbangla" could not be found or installed (offline?)`.
