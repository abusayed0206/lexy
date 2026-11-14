# Quickstart: validating Bangla and multilingual support

## Prerequisites

- Lexy setup done (MiKTeX, latexmk, Perl). LaTeXbangla comes from MiKTeX (installed on first use).
- A tested Bangla font installed, for example Kalpurush or Siyam Rupali.
- The LaTeXbangla examples: <https://github.com/Neehan/LaTeXbangla/tree/main/examples> (`bangla.tex`, `assamese.tex`).

## Automated checks

```powershell
cd src-tauri; cargo test engine        # choose_engine: marker wins, packages, classes, comments, preamble \input
cd src-tauri; cargo test font_summary  # "The font ... cannot be found" → Font "X" not found
cd src-tauri; cargo test snapshot_stem # ASCII stems kept, Bangla stems → document
cd src-tauri; cargo test junction      # created for non-ASCII roots, reused, replaced, never followed on cleanup
cd src-tauri; cargo test compile_end_to_end_when_tools_are_installed   # adds LaTeXbangla, project font, Bangla names
npm test                               # Editor: Bangla cluster delete, RTL line direction; Ribbon engine tooltip
```

The e2e additions skip quietly (print "skipping") when MiKTeX/latexmk/Perl or a Bangla font is missing.

## Manual scenarios

1. **US1 (the reported failure)**: New project, paste `examples/bangla.tex` as the main document (no engine line), F5 → PDF with joined Bangla letters. Status tooltip: `XeLaTeX · PDF ready`.
2. **US1**: Add `% !TEX program = lualatex` at the top → tooltip shows LuaLaTeX. Remove it and remove `\usepackage{latexbangla}`, write English only → pdfLaTeX.
3. **US2**: Copy a Bangla font file (not installed) to `fonts\MyBangla.ttf` in the project, use `\setbanglamainfont{MyBangla.ttf}[Path=fonts/]`, F5 → PDF uses it. Misspell the name → summary `Font "…" not found`.
4. **US2**: Pick "Georgia" in Home → Font on the Bangla document → English text changes, Bangla lines untouched, compiles.
5. **US3**: Paste Bangla, Hindi, Arabic and Chinese sentences into the editor: no boxes; the Arabic line reads right to left; Backspace after "ক্ষ" removes it whole; typing with Avro or the Windows Bangla keyboard works.
6. **US4**: New project "আমার প্রবন্ধ", add chapter `অধ্যায়\ভূমিকা.tex`, `\input{অধ্যায়/ভূমিকা}`, F5, close → `আমার প্রবন্ধ.pdf` next to the main file.
7. **US5**: On a machine without the latexbangla package (or after `mpm --uninstall=latexbangla` in a test profile), compile the example → package installs, no dialog, PDF appears. Offline → summary names the package.
