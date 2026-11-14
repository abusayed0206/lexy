# Contract: Compile behaviour (Rust, `src-tauri/src/lib.rs`)

The command surface does not change: `compile_project(main, buffers) -> CompileResult` keeps its arguments and result shape ([spec 004 contract](../../004-project-workspace/contracts/backend-commands.md)). What changes is how it runs latexmk.

## Engine

- `choose_engine(main_text, preamble_inputs) -> EngineChoice` decides (see [data-model.md](../data-model.md#enginechoice)). It replaces the direct `engine_from_marker` call; the marker parser stays and is step 1.
- `CompileResult.engine` reports the engine actually used (already serialized).
- The compile log starts with one line `Engine: <Name> (<reason>)`, for example `Engine: XeLaTeX (latexbangla)` or `Engine: pdfLaTeX (default)`.

## latexmk invocation

```
latexmk <-pdf|-xelatex|-lualatex> -interaction=nonstopmode -halt-on-error -file-line-error
        -pdflatex="pdflatex -enable-installer %O %S"
        -xelatex="xelatex -enable-installer %O %S"
        -lualatex="lualatex -enable-installer %O %S"
        <stem>.tex
```

- Working directory: the out dir (unchanged).
- `<stem>` is ASCII-only (data-model BuildLayout).
- Environment: `PATH` (tools first, unchanged); `TEXINPUTS`, `BIBINPUTS`, `TTFONTS`, `OPENTYPEFONTS` all set to `<out dir>\.lexy-overlay;<project path for TeX>;`, every path ASCII-only.

## Junction (`<out dir>\.lexy-root`)

- Created only when the canonical project root contains non-ASCII characters, with `mklink /J` through the hidden-console process helper (no admin needed).
- Reused when it exists and points at the current root; replaced (link removed with `rmdir`, never a recursive delete) when it points elsewhere.
- If creation fails, compile with the plain root and add one log line `Could not create an ASCII link to the project folder; files with non-Latin names may not be found.`
- Never deleted recursively; `mirror_folders` and the overlay cleanup must skip it (its name starts with `.`, which they already skip, and a test asserts the project survives a cleanup pass).

## Summary

The existing rules apply, after two new checks on the TeX log: font not found, then package install failed ([data-model.md](../data-model.md#compilesummary-patterns-added)).

## Export

`export_pdf(pdfPath, mainAbs)` is unchanged: it already names the PDF after the main document, so `আমার প্রবন্ধ.tex` exports `আমার প্রবন্ধ.pdf` even though the build file is `document.pdf`.
