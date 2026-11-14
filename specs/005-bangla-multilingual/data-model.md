# Data Model: Seamless Bangla and Multilingual Documents

No stored data changes. These are the values one compile computes.

## EngineChoice

| Field | Type | Rules |
|-------|------|-------|
| engine | `pdflatex \| xelatex \| lualatex` | Serialized lowercase in `CompileResult.engine` (unchanged) |
| reason | `marker \| package(name) \| default` | Internal (logged at the top of the compile log as `Engine: XeLaTeX (latexbangla)`) |

Decision order (research R1):
1. `% !TEX program = …` / `TS-program` in the first 5 lines → that engine.
2. Else the first package or class in the preamble that is on `UNICODE_ENGINE_PACKAGES` → `xelatex`, reason `package(name)`.
3. Else `pdflatex`, reason `default`.

The preamble is the main text before `\begin{document}`, plus the text of files it `\input`s or `\include`s before `\begin{document}` (one level, `.tex` added when missing, buffer text preferred over disk). Comments (`%` to end of line, not `\%`) are removed first.

`UNICODE_ENGINE_PACKAGES` = `latexbangla, fontspec, polyglossia, unicode-math, xeCJK, luatexja, bidi, xltxtra, xunicode, mathspec`; classes `bookbangla, ctexart, ctexbook, ctexrep`. Matching is exact per name inside `\usepackage[…]{a,b,c}` lists.

## BuildLayout (per compile)

| Field | Value | Rules |
|-------|-------|-------|
| build root | `%LOCALAPPDATA%\Lexy\Build` | Falls back to `%ProgramData%\Lexy\Build\<hash(user profile path)>` when `%LOCALAPPDATA%` is not plain ASCII |
| out dir | `<build root>\<hash(main path)>` | Unchanged |
| stem | main file stem if plain ASCII and free of `%#&{}~^$` and spaces at ends, else `document` | Exported PDF keeps the real name |
| project path for TeX | the project root if plain ASCII, else the junction `<out dir>\.lexy-root` → root | Junction recreated if missing or pointing elsewhere |
| search path | `<out dir>\.lexy-overlay;<project path for TeX>;` | Used for `TEXINPUTS`, `BIBINPUTS`, `TTFONTS`, `OPENTYPEFONTS` |

"Plain ASCII" = every character is printable ASCII (0x20–0x7E).

## CompileSummary patterns (added)

| Log text (lines joined, `(fontspec)` prefixes removed) | Summary |
|------|---------|
| `The font "X" cannot be found` | `Font "X" not found` |
| ``LaTeX Error: File `X.sty' not found.`` (or `.cls`), after MiKTeX's installer was enabled | `Package "X" could not be found or installed (offline?)` |
| otherwise | existing `first_latex_error` rules |
