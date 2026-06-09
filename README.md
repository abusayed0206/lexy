# Lexy

Lexy is a Windows-first minimal LaTeX writer built with Tauri 2, React, TypeScript, and Rust. It is planned to use MiKTeX and Strawberry Perl under the hood while keeping installation and first-run setup smooth for non-developer users.

## Required Reading

Before working on this project, read these files:

1. `docs/PLAN.md`
2. `docs/DESIGN.md`
3. `docs/TRACKER.md`
4. `docs/SETUP.md`

Update `docs/TRACKER.md` whenever a feature changes status. Add new manual feature ideas to the manual intake table first.

## Development

```powershell
npm install
npm run tauri dev
```

## Build

```powershell
npm run tauri build
```

Use Context7 for current framework and packaging docs before making implementation decisions that depend on Tauri, Rust libraries, React, MiKTeX, Strawberry Perl, installers, or Windows behavior.
