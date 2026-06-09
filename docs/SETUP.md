# Lexy Initial Setup Process

Last updated: 2026-06-10

This document defines how Lexy checks and installs the LaTeX toolchain during initial setup. Users should not need to open MiKTeX, Strawberry Perl, PowerShell, or any setup wizard.

Sources checked:

- MiKTeX deployment guide: https://miktex.org/howto/deploy-miktex
- MiKTeX setup utility manual: https://docs.miktex.org/manual/miktexsetup.html
- Strawberry Perl releases: https://strawberryperl.com/releases.html
- Strawberry Perl GitHub release structure: https://github.com/StrawberryPerl/Perl-Dist-Strawberry/releases/download/SP_54221_64bit/strawberry-perl-5.42.2.1-64bit.msi
- Tauri 2 Context7 docs for Windows bundles, resources, sidecars, commands, and frontend progress events.

## Required Tools

Lexy needs these tools before it can compile a document:

| Tool | Why Lexy Needs It | Check |
| --- | --- | --- |
| MiKTeX | TeX distribution and package management. | `miktex --version` |
| latexmk | Build automation for LaTeX documents. | `latexmk --version` |
| Strawberry Perl | Perl runtime used by `latexmk` on Windows. | `perl --version` |

## Version Check Flow

Lexy checks in this order:

1. App-managed install locations under `%LOCALAPPDATA%\Lexy\Setup`.
2. Common per-user MiKTeX locations under `%LOCALAPPDATA%`.
3. Common Strawberry Perl locations such as `C:\Strawberry\perl\bin\perl.exe`.
4. Executables available on the current process `PATH`.

The backend command is:

```text
check_environment
```

It returns structured status for MiKTeX, `latexmk`, and Perl:

- installed or missing.
- detected version line.
- executable path if known.
- user-facing message.

## MiKTeX Install Flow

The official MiKTeX deployment guide recommends the standalone Windows setup utility for unattended deployment. The setup utility supports two relevant tasks:

- `download`: create a local package repository.
- `install`: install MiKTeX from that local repository.

Lexy follows that two-step model:

1. Download `https://miktex.org/download/win/miktexsetup-x64.zip`.
2. Extract `miktexsetup_standalone.exe`.
3. Create a local package repository:

```powershell
miktexsetup_standalone --verbose --local-package-repository <repo> --package-set=basic download
```

4. Install for the current user only:

```powershell
miktexsetup_standalone --verbose --local-package-repository <repo> --shared=no --modify-path=no --package-set=basic --user-install <install> --user-config <config> --user-data <data> install
```

Current Lexy paths:

| Item | Path |
| --- | --- |
| Setup root | `%LOCALAPPDATA%\Lexy\Setup` |
| Downloads | `%LOCALAPPDATA%\Lexy\Setup\downloads` |
| MiKTeX repository | `%LOCALAPPDATA%\Lexy\Setup\miktex-repository` |
| MiKTeX install | `%LOCALAPPDATA%\Lexy\Setup\MiKTeX` |
| MiKTeX config | `%LOCALAPPDATA%\Lexy\Setup\MiKTeXConfig` |
| MiKTeX data | `%LOCALAPPDATA%\Lexy\Setup\MiKTeXData` |

The install is intentionally `--shared=no` to avoid requiring a system-wide GUI setup. `--modify-path=no` keeps the install app-managed; Lexy should pass the resolved binary paths when compiling.

## Strawberry Perl: MSI Or Portable?

Strawberry Perl publishes MSI and portable releases. The official releases page describes MSI builds as full install packages and portable builds as archives that can be unzipped anywhere.

For Lexy:

- MSI is simple, stable, and currently implemented with silent `msiexec`.
- Portable is attractive for a future app-managed install because it avoids system changes and can live fully under `%LOCALAPPDATA%\Lexy`.
- Portable needs a confirmed release asset URL, extraction flow, and compile-time PATH injection so `latexmk` can find `perl.exe`.

Current implementation uses the 64-bit MSI URL supplied in the request:

```text
https://github.com/StrawberryPerl/Perl-Dist-Strawberry/releases/download/SP_54221_64bit/strawberry-perl-5.42.2.1-64bit.msi
```

Silent install command:

```powershell
msiexec /i strawberry-perl-5.42.2.1-64bit.msi /qn /norestart
```

Production recommendation: move to portable Strawberry Perl if we confirm the asset URL and extraction behavior, because the product goal is no GUI and minimum system friction.

## Progress Reporting

The backend emits `setup-progress` events. The frontend listens and updates the setup screen.

Progress states:

- `running`: current step is active.
- `done`: current step completed.
- `error`: current step failed.

Current steps:

1. Check existing tools.
2. Download Strawberry Perl.
3. Install Strawberry Perl.
4. Download MiKTeX setup.
5. Extract MiKTeX setup.
6. Download MiKTeX package repository.
7. Install MiKTeX.
8. Verify final versions.

## Security Notes

The implementation has the SHA-256 verification hook in place, but current source pages do not provide pinned checksums in the referenced docs. Before production release:

1. Pin exact installer versions.
2. Add SHA-256 values to the backend constants.
3. Fail setup if hashes do not match.
4. Prefer bundling installers through Tauri resources if licensing, update policy, and installer size allow it.

## Current Gaps

- Real-time stdout parsing from MiKTeX setup is not implemented; progress is phase-based plus byte progress for direct downloads.
- Strawberry Perl portable install is documented but not implemented.
- Setup logs are summarized in progress events, but a persistent log file is not implemented yet.
- Fresh Windows VM validation is still required.
