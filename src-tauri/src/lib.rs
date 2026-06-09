use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    env,
    ffi::OsStr,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use tauri::{AppHandle, Emitter};

const MIKTEX_SETUP_URL: &str = "https://miktex.org/download/win/miktexsetup-x64.zip";
const STRAWBERRY_PERL_MSI_URL: &str = "https://github.com/StrawberryPerl/Perl-Dist-Strawberry/releases/download/SP_54221_64bit/strawberry-perl-5.42.2.1-64bit.msi";
const MIKTEX_SETUP_SHA256: Option<&str> = None;
const STRAWBERRY_PERL_MSI_SHA256: Option<&str> = None;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolProbe {
    name: &'static str,
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentStatus {
    ready: bool,
    miktex: ToolProbe,
    perl: ToolProbe,
    latexmk: ToolProbe,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupProgress {
    step: &'static str,
    label: String,
    detail: String,
    progress: Option<u8>,
    state: &'static str,
}

#[tauri::command]
fn check_environment() -> EnvironmentStatus {
    detect_environment()
}

#[tauri::command]
fn start_initial_setup(app: AppHandle) -> Result<EnvironmentStatus, String> {
    emit_progress(
        &app,
        "check",
        "Checking existing tools",
        "Looking for MiKTeX, latexmk, and Strawberry Perl.",
        Some(0),
        "running",
    );

    let before = detect_environment();
    if before.ready {
        emit_progress(
            &app,
            "complete",
            "Setup complete",
            "Required LaTeX tools are already installed.",
            Some(100),
            "done",
        );
        return Ok(before);
    }

    let setup_root = setup_root()?;
    let download_dir = setup_root.join("downloads");
    fs::create_dir_all(&download_dir).map_err(|error| format!("failed to create setup cache: {error}"))?;

    if !before.perl.installed {
        install_strawberry_perl(&app, &download_dir)?;
    }

    let after_perl = detect_environment();
    if !after_perl.miktex.installed || !after_perl.latexmk.installed {
        install_miktex(&app, &setup_root, &download_dir)?;
    }

    emit_progress(
        &app,
        "verify",
        "Verifying setup",
        "Checking command versions after installation.",
        Some(92),
        "running",
    );
    let after = detect_environment();
    if !after.ready {
        emit_progress(
            &app,
            "verify",
            "Setup needs attention",
            "One or more required tools could not be verified. Open the setup log and retry.",
            Some(100),
            "error",
        );
        return Err("initial setup finished, but required tools were not verified".to_string());
    }

    emit_progress(
        &app,
        "complete",
        "Setup complete",
        "MiKTeX, latexmk, and Strawberry Perl are ready.",
        Some(100),
        "done",
    );
    Ok(after)
}

fn detect_environment() -> EnvironmentStatus {
    let perl = probe_tool("Strawberry Perl", "perl", &["--version"], &perl_candidates());
    let miktex = probe_tool("MiKTeX", "miktex", &["--version"], &miktex_candidates("miktex"));
    let latexmk = probe_tool("latexmk", "latexmk", &["--version"], &miktex_candidates("latexmk"));

    EnvironmentStatus {
        ready: perl.installed && miktex.installed && latexmk.installed,
        miktex,
        perl,
        latexmk,
    }
}

fn probe_tool(
    name: &'static str,
    command_name: &str,
    version_args: &[&str],
    candidates: &[PathBuf],
) -> ToolProbe {
    let executable = candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .or_else(|| find_on_path(command_name));

    let Some(path) = executable else {
        return ToolProbe {
            name,
            installed: false,
            version: None,
            path: None,
            message: format!("{name} was not found."),
        };
    };

    match Command::new(&path)
        .args(version_args)
        .stdin(Stdio::null())
        .output()
    {
        Ok(output) if output.status.success() => {
            let version = first_output_line(&output.stdout).or_else(|| first_output_line(&output.stderr));
            ToolProbe {
                name,
                installed: true,
                version,
                path: Some(path.display().to_string()),
                message: format!("{name} is available."),
            }
        }
        Ok(output) => ToolProbe {
            name,
            installed: false,
            version: None,
            path: Some(path.display().to_string()),
            message: format!("{name} exists but returned exit code {:?}.", output.status.code()),
        },
        Err(error) => ToolProbe {
            name,
            installed: false,
            version: None,
            path: Some(path.display().to_string()),
            message: format!("{name} could not be executed: {error}"),
        },
    }
}

fn install_strawberry_perl(app: &AppHandle, download_dir: &Path) -> Result<(), String> {
    let msi_path = download_dir.join("strawberry-perl-5.42.2.1-64bit.msi");
    emit_progress(
        app,
        "perl-download",
        "Downloading Strawberry Perl",
        "Using the official 64-bit MSI release.",
        Some(8),
        "running",
    );
    download_file(
        app,
        STRAWBERRY_PERL_MSI_URL,
        &msi_path,
        STRAWBERRY_PERL_MSI_SHA256,
        "perl-download",
        8,
        30,
    )?;

    emit_progress(
        app,
        "perl-install",
        "Installing Strawberry Perl",
        "Running the MSI silently. Windows may request elevation if the MSI requires it.",
        Some(32),
        "running",
    );
    run_command(
        app,
        "perl-install",
        "msiexec",
        &[
            OsStr::new("/i"),
            msi_path.as_os_str(),
            OsStr::new("/qn"),
            OsStr::new("/norestart"),
        ],
        None,
    )?;
    emit_progress(
        app,
        "perl-install",
        "Strawberry Perl installed",
        "Perl installation command completed.",
        Some(40),
        "done",
    );
    Ok(())
}

fn install_miktex(app: &AppHandle, setup_root: &Path, download_dir: &Path) -> Result<(), String> {
    let zip_path = download_dir.join("miktexsetup-x64.zip");
    let utility_dir = setup_root.join("miktexsetup");
    let repository_dir = setup_root.join("miktex-repository");
    let install_dir = setup_root.join("MiKTeX");
    let config_dir = setup_root.join("MiKTeXConfig");
    let data_dir = setup_root.join("MiKTeXData");

    fs::create_dir_all(&utility_dir).map_err(|error| format!("failed to create MiKTeX setup dir: {error}"))?;
    fs::create_dir_all(&repository_dir).map_err(|error| format!("failed to create MiKTeX repository dir: {error}"))?;

    emit_progress(
        app,
        "miktex-download",
        "Downloading MiKTeX setup",
        "Fetching the standalone setup utility from miktex.org.",
        Some(42),
        "running",
    );
    download_file(
        app,
        MIKTEX_SETUP_URL,
        &zip_path,
        MIKTEX_SETUP_SHA256,
        "miktex-download",
        42,
        52,
    )?;

    emit_progress(
        app,
        "miktex-extract",
        "Preparing MiKTeX setup",
        "Extracting the standalone command-line setup utility.",
        Some(54),
        "running",
    );
    expand_archive(app, &zip_path, &utility_dir)?;
    let setup_exe = find_file_named(&utility_dir, "miktexsetup_standalone.exe")
        .ok_or_else(|| "miktexsetup_standalone.exe was not found after extraction".to_string())?;
    let repository_arg = format!("--local-package-repository={}", repository_dir.display());

    emit_progress(
        app,
        "miktex-repository",
        "Downloading MiKTeX packages",
        "Creating a local basic MiKTeX package repository. This can take several minutes.",
        Some(58),
        "running",
    );
    run_command(
        app,
        "miktex-repository",
        setup_exe.as_os_str(),
        &[
            OsStr::new("--verbose"),
            OsStr::new(&repository_arg),
            OsStr::new("--package-set=basic"),
            OsStr::new("download"),
        ],
        None,
    )?;

    emit_progress(
        app,
        "miktex-install",
        "Installing MiKTeX",
        "Installing MiKTeX for the current user with no setup wizard.",
        Some(76),
        "running",
    );
    let install_arg = format!("--user-install={}", install_dir.display());
    let config_arg = format!("--user-config={}", config_dir.display());
    let data_arg = format!("--user-data={}", data_dir.display());
    run_command(
        app,
        "miktex-install",
        setup_exe.as_os_str(),
        &[
            OsStr::new("--verbose"),
            OsStr::new(&repository_arg),
            OsStr::new("--shared=no"),
            OsStr::new("--modify-path=no"),
            OsStr::new("--package-set=basic"),
            OsStr::new(&install_arg),
            OsStr::new(&config_arg),
            OsStr::new(&data_arg),
            OsStr::new("install"),
        ],
        None,
    )?;

    emit_progress(
        app,
        "miktex-install",
        "MiKTeX installed",
        "MiKTeX installation command completed.",
        Some(88),
        "done",
    );
    Ok(())
}

fn download_file(
    app: &AppHandle,
    url: &str,
    destination: &Path,
    expected_sha256: Option<&str>,
    step: &'static str,
    start_percent: u8,
    end_percent: u8,
) -> Result<(), String> {
    if expected_sha256.is_none() {
        emit_progress(
            app,
            step,
            "Checksum not configured",
            "Using TLS and official source URL. Add a pinned SHA-256 before production release.",
            Some(start_percent),
            "running",
        );
    }

    let command = format!(
        "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '{}' -OutFile '{}'",
        powershell_escape_text(url),
        powershell_escape(destination),
    );
    emit_progress(
        app,
        step,
        "Downloading",
        "Downloading from the official source. This may take a while.",
        Some(start_percent),
        "running",
    );
    run_command(
        app,
        step,
        "powershell",
        &[
            OsStr::new("-NoProfile"),
            OsStr::new("-ExecutionPolicy"),
            OsStr::new("Bypass"),
            OsStr::new("-Command"),
            OsStr::new(&command),
        ],
        None,
    )?;

    verify_sha256(destination, expected_sha256)?;
    emit_progress(
        app,
        step,
        "Download complete",
        &format!(
            "Saved {} ({}).",
            destination.display(),
            downloaded_file_size(destination)?
        ),
        Some(end_percent),
        "done",
    );
    Ok(())
}

fn verify_sha256(path: &Path, expected_sha256: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected_sha256 else {
        return Ok(());
    };

    let mut file = File::open(path).map_err(|error| format!("failed to open {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "checksum mismatch for {}: expected {expected}, got {actual}",
            path.display()
        ));
    }
    Ok(())
}

fn expand_archive(app: &AppHandle, zip_path: &Path, destination: &Path) -> Result<(), String> {
    let command = format!(
        "Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
        powershell_escape(zip_path),
        powershell_escape(destination)
    );
    run_command(
        app,
        "miktex-extract",
        "powershell",
        &[
            OsStr::new("-NoProfile"),
            OsStr::new("-ExecutionPolicy"),
            OsStr::new("Bypass"),
            OsStr::new("-Command"),
            OsStr::new(&command),
        ],
        None,
    )
}

fn run_command<S: AsRef<OsStr>>(
    app: &AppHandle,
    step: &'static str,
    program: S,
    args: &[&OsStr],
    current_dir: Option<&Path>,
) -> Result<(), String> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(current_dir) = current_dir {
        command.current_dir(current_dir);
    }

    let output = command
        .output()
        .map_err(|error| format!("failed to start setup command: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = summarize_command_output(&stdout, &stderr);

    if output.status.success() {
        emit_progress(app, step, "Command completed", &detail, None, "done");
        Ok(())
    } else {
        emit_progress(app, step, "Command failed", &detail, None, "error");
        Err(format!(
            "setup command failed with exit code {:?}: {detail}",
            output.status.code()
        ))
    }
}

fn emit_progress(
    app: &AppHandle,
    step: &'static str,
    label: impl Into<String>,
    detail: impl Into<String>,
    progress: Option<u8>,
    state: &'static str,
) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            step,
            label: label.into(),
            detail: detail.into(),
            progress,
            state,
        },
    );
}

fn find_on_path(command_name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for entry in env::split_paths(&path) {
        let candidate = entry.join(command_name);
        if candidate.exists() {
            return Some(candidate);
        }

        #[cfg(windows)]
        {
            let candidate = entry.join(format!("{command_name}.exe"));
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn perl_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    candidates.push(PathBuf::from(r"C:\Strawberry\perl\bin\perl.exe"));
    if let Some(program_files) = env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join(r"Strawberry\perl\bin\perl.exe"));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local_app_data).join(r"Programs\Strawberry\perl\bin\perl.exe"));
    }
    candidates
}

fn miktex_candidates(command_name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(root) = setup_root() {
        candidates.push(root.join(r"MiKTeX\miktex\bin\x64").join(format!("{command_name}.exe")));
        candidates.push(root.join(r"MiKTeX\miktex\bin").join(format!("{command_name}.exe")));
    }
    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local_app_data);
        candidates.push(local.join(r"Programs\MiKTeX\miktex\bin\x64").join(format!("{command_name}.exe")));
        candidates.push(local.join(r"MiKTeX\miktex\bin\x64").join(format!("{command_name}.exe")));
    }
    candidates
}

fn setup_root() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "LOCALAPPDATA is not set".to_string())?;
    Ok(base.join("Lexy").join("Setup"))
}

fn find_file_named(root: &Path, name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.file_name().and_then(OsStr::to_str) == Some(name) {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, name) {
                return Some(found);
            }
        }
    }
    None
}

fn first_output_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

fn summarize_command_output(stdout: &str, stderr: &str) -> String {
    stderr
        .lines()
        .chain(stdout.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("No output.")
        .to_string()
}

fn format_bytes(bytes: u64) -> String {
    const MIB: u64 = 1024 * 1024;
    if bytes >= MIB {
        format!("{:.1} MiB", bytes as f64 / MIB as f64)
    } else {
        format!("{bytes} bytes")
    }
}

fn powershell_escape(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

fn powershell_escape_text(value: &str) -> String {
    value.replace('\'', "''")
}

fn downloaded_file_size(path: &Path) -> Result<String, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("failed to stat {}: {error}", path.display()))?;
    Ok(format_bytes(metadata.len()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_environment,
            start_initial_setup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
