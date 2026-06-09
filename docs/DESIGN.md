# Lexy Design Brief

Last updated: 2026-06-10

Lexy should feel like a fast native writing tool, not a web dashboard. The interface should be sparse, predictable, and optimized for repeated writing and compiling.

## Product Shape

Primary layout:

```text
Top command strip
Editor pane | PDF preview pane
Status/log drawer
```

The editor is the main object. Everything else supports writing, compiling, and understanding errors.

## Visual Direction

- Use a restrained neutral palette with one accent color.
- Avoid large hero sections, cards inside cards, decorative gradients, and marketing copy.
- Prefer thin separators, compact controls, and dense but readable spacing.
- Use 8px radius or less where rounded corners are needed.
- Keep typography practical: normal letter spacing, no viewport-scaled font sizes.
- Make the brand visible through title, icon, and polish, not large promotional text.

## First Screen

First launch has two possible states:

1. Dependencies valid: open directly to the writer.
2. Dependencies missing: show a compact setup state with dependency names, progress, and a single primary action.

Do not show a landing page. Do not explain the whole app on screen. Setup text should be operational and short.

## Main Writer UI

Required controls:

- New file.
- Open file.
- Save file.
- Compile.
- Auto compile toggle.
- Show/hide logs.
- Settings.

Use icons for common commands. Text labels are allowed when ambiguity would slow users down, especially for `Compile` and setup actions.

Editor expectations:

- Monospace font.
- Clear dirty state.
- Line numbers are optional for MVP but expected later.
- No text should overlap controls at narrow widths.
- Pane split should be resizable after MVP if it does not add complexity.

Preview expectations:

- Blank state when no PDF exists.
- Loading state during compile.
- Error state points users to logs.
- Successful compile refreshes without visible flicker where possible.

Log expectations:

- Collapsed by default unless compile fails.
- Preserve the raw LaTeX log, but show a concise summary first.
- Allow copying logs.

## Setup UX

Dependency setup should show:

- MiKTeX status.
- Strawberry Perl status.
- `latexmk` status.
- Current operation.
- Progress if installer/download reports progress.
- A link/button to open setup logs after failure.

Avoid silent blocking startup. If setup may take minutes, show progress immediately.

## Settings

Settings should be small and task-focused:

- Dependency paths and recheck button.
- Auto compile on/off and debounce interval.
- Compiler command options.
- Theme preference.
- App version and logs path.

Do not build a broad preferences system until required.

## Keyboard Shortcuts

Initial shortcuts:

- `Ctrl+N`: new file.
- `Ctrl+O`: open file.
- `Ctrl+S`: save.
- `Ctrl+Shift+S`: save as.
- `Ctrl+B` or `F5`: compile. Pick one before implementation and document it in tracker.
- `Ctrl+L`: toggle logs.

Shortcuts must not conflict with text editing expectations.

## Accessibility And Responsiveness

- Every icon-only button needs an accessible name and tooltip.
- Focus order must follow visual order.
- Text must fit at 100%, 125%, and 150% Windows display scaling.
- The app should remain usable at 800x600, matching the current Tauri window baseline.
- Error states must not rely on color alone.

## Copy Style

Use short operational copy:

- "Compiling"
- "PDF ready"
- "MiKTeX missing"
- "Install dependencies"
- "Open log"

Avoid vague copy:

- "Something went wrong"
- "Magic setup"
- "Modern workspace"
- "Boost productivity"

## Manual Design Notes

Add manual design ideas below. Keep each note dated and move accepted work into `docs/TRACKER.md`.

| Date | Author | Note | Decision |
| --- | --- | --- | --- |
| 2026-06-10 | Codex | Keep MVP as split editor/preview with a compact command strip. | Accepted |
