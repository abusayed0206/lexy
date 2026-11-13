//! First-run installer for Strawberry Perl and MiKTeX.
//!
//! Everything installs per-user under `%LOCALAPPDATA%\Lexy\Setup` with no admin rights:
//! Strawberry Perl from its portable ZIP (pinned SHA-256), MiKTeX via its standalone
//! setup utility. Downloads and unzipping report byte progress; MiKTeX's own output is
//! streamed line by line. Every event also goes to `setup.log` for the "Details" view.

use super::{
    detect_environment, find_file_named, format_bytes, hide_console, verify_sha256, EnvironmentStatus,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};

pub(crate) const PERL_ZIP_URL: &str = "https://github.com/StrawberryPerl/Perl-Dist-Strawberry/releases/download/SP_54221_64bit/strawberry-perl-5.42.2.1-64bit-portable.zip";
/// From the GitHub release asset digest (checked 2026-11-13).
pub(crate) const PERL_ZIP_SHA256: &str = "32d83be90cf04b807cfb9477482bc36302cdee6f5b04cf57e81adecbd8f07898";
pub(crate) const PERL_ZIP_SIZE: u64 = 304_301_401;
const PERL_ZIP_NAME: &str = "strawberry-perl-5.42.2.1-64bit-portable.zip";
/// Left over from the old MSI flow; removed to free ~200 MB.
const OLD_PERL_MSI_NAME: &str = "strawberry-perl-5.42.2.1-64bit.msi";

// shortcut: MiKTeX publishes this utility only at a rolling "latest" URL, so it can't be
// hash-pinned; it arrives over HTTPS from miktex.org. Pin a versioned URL when one exists.
const MIKTEX_SETUP_URL: &str = "https://miktex.org/download/win/miktexsetup-x64.zip";

/// Folder (under the setup root) that holds the portable Perl.
pub(crate) const PERL_DIR: &str = "StrawberryPerl";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Step {
    pub id: &'static str,
    start: u8,
    end: u8,
}

pub(crate) const CHECK: Step = Step { id: "check", start: 0, end: 2 };
pub(crate) const PERL_DOWNLOAD: Step = Step { id: "perl-download", start: 2, end: 50 };
pub(crate) const PERL_EXTRACT: Step = Step { id: "perl-extract", start: 50, end: 62 };
pub(crate) const MIKTEX_DOWNLOAD: Step = Step { id: "miktex-download", start: 62, end: 65 };
pub(crate) const MIKTEX_EXTRACT: Step = Step { id: "miktex-extract", start: 65, end: 66 };
pub(crate) const MIKTEX_PACKAGES: Step = Step { id: "miktex-packages", start: 66, end: 86 };
pub(crate) const MIKTEX_INSTALL: Step = Step { id: "miktex-install", start: 86, end: 96 };
pub(crate) const VERIFY: Step = Step { id: "verify", start: 96, end: 100 };

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupProgress {
    pub step: &'static str,
    /// running | done | skipped | error
    pub state: &'static str,
    pub label: String,
    pub detail: String,
    /// Overall progress 0–100.
    pub progress: u8,
    pub bytes_done: Option<u64>,
    pub bytes_total: Option<u64>,
}

/// Sends progress to the UI (or a test) and appends it to the setup log.
pub(crate) struct Reporter<'a> {
    emit: &'a (dyn Fn(SetupProgress) + Sync),
    log: Mutex<Option<File>>,
    started: Instant,
}

impl<'a> Reporter<'a> {
    pub fn new(emit: &'a (dyn Fn(SetupProgress) + Sync), log_path: Option<&Path>) -> Self {
        let log = log_path.and_then(|path| {
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            File::create(path).ok()
        });
        Self { emit, log: Mutex::new(log), started: Instant::now() }
    }

    pub fn log(&self, line: &str) {
        if let Ok(mut guard) = self.log.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = writeln!(file, "[{:>7.1}s] {line}", self.started.elapsed().as_secs_f64());
            }
        }
    }

    fn send(&self, step: Step, state: &'static str, label: &str, detail: &str, fraction: f64, bytes: Option<(u64, Option<u64>)>) {
        let fraction = fraction.clamp(0.0, 1.0);
        let progress = step.start as f64 + (step.end - step.start) as f64 * fraction;
        if state != "running" || bytes.is_none() {
            self.log(&format!("{} {state}: {label}{}", step.id, if detail.is_empty() { String::new() } else { format!(" — {detail}") }));
        }
        (self.emit)(SetupProgress {
            step: step.id,
            state,
            label: label.to_string(),
            detail: detail.to_string(),
            progress: progress.round() as u8,
            bytes_done: bytes.map(|(done, _)| done),
            bytes_total: bytes.and_then(|(_, total)| total),
        });
    }

    pub fn running(&self, step: Step, label: &str, detail: &str) {
        self.send(step, "running", label, detail, 0.0, None);
    }

    pub fn advance(&self, step: Step, label: &str, detail: &str, fraction: f64, bytes: Option<(u64, Option<u64>)>) {
        self.send(step, "running", label, detail, fraction, bytes);
    }

    pub fn done(&self, step: Step, label: &str, detail: &str) {
        self.send(step, "done", label, detail, 1.0, None);
    }

    pub fn skipped(&self, step: Step, label: &str, detail: &str) {
        self.send(step, "skipped", label, detail, 1.0, None);
    }

    pub fn error(&self, step: Step, label: &str, detail: &str) {
        self.send(step, "error", label, detail, 0.0, None);
    }

    /// Run one step; on failure mark it as an error with a readable message.
    fn attempt<T>(&self, step: Step, label: &str, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        work().map_err(|error| {
            self.error(step, &format!("{label} failed"), &error);
            format!("{label} failed: {error}")
        })
    }
}

/// Install whatever is missing, then verify. Returns the final environment.
pub(crate) fn run_setup(report: &Reporter, root: &Path) -> Result<EnvironmentStatus, String> {
    report.running(CHECK, "Checking existing tools", "Looking for MiKTeX, latexmk and Strawberry Perl.");
    let before = detect_environment();
    let missing = missing_names(&before);
    report.done(
        CHECK,
        "Checked existing tools",
        &if missing.is_empty() { "Everything is already installed.".to_string() } else { format!("Missing: {}.", missing.join(", ")) },
    );

    let downloads = root.join("downloads");
    fs::create_dir_all(&downloads).map_err(|error| format!("Lexy could not create {}: {error}", downloads.display()))?;
    let _ = fs::remove_file(downloads.join(OLD_PERL_MSI_NAME));

    if before.perl.installed {
        report.skipped(PERL_DOWNLOAD, "Strawberry Perl already installed", before.perl.path.as_deref().unwrap_or(""));
        report.skipped(PERL_EXTRACT, "Strawberry Perl already installed", "");
    } else {
        install_perl(report, root, &downloads)?;
    }

    match miktex_plan(&before) {
        MiktexPlan::Nothing => {
            for step in [MIKTEX_DOWNLOAD, MIKTEX_EXTRACT, MIKTEX_PACKAGES, MIKTEX_INSTALL] {
                report.skipped(step, "MiKTeX already installed", "");
            }
        }
        MiktexPlan::LatexmkPackage => {
            report.skipped(MIKTEX_DOWNLOAD, "MiKTeX already installed", "");
            report.skipped(MIKTEX_EXTRACT, "MiKTeX already installed", "");
            install_latexmk_package(report, before.miktex.path.as_deref())?;
            report.skipped(MIKTEX_INSTALL, "MiKTeX already installed", "");
        }
        MiktexPlan::Full => install_miktex(report, root, &downloads)?,
    }

    report.running(VERIFY, "Verifying tools", "Running each tool once to check it works.");
    let after = detect_environment();
    let still_missing = missing_names(&after);
    if !still_missing.is_empty() {
        let message = format!("{} could not be verified after setup.", still_missing.join(", "));
        report.error(VERIFY, "Setup needs attention", &message);
        return Err(message);
    }
    report.done(VERIFY, "Setup complete", "MiKTeX, latexmk and Strawberry Perl are ready.");
    Ok(after)
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MiktexPlan {
    Nothing,
    LatexmkPackage,
    Full,
}

/// Decide from what is on disk, not from whether a tool ran: latexmk.exe exists but
/// fails while Perl is missing, and installing Perl fixes that by itself.
pub(crate) fn miktex_plan(environment: &EnvironmentStatus) -> MiktexPlan {
    if !environment.miktex.installed {
        MiktexPlan::Full
    } else if environment.latexmk.path.is_none() {
        MiktexPlan::LatexmkPackage
    } else {
        MiktexPlan::Nothing
    }
}

fn missing_names(environment: &EnvironmentStatus) -> Vec<&'static str> {
    [&environment.miktex, &environment.latexmk, &environment.perl]
        .into_iter()
        .filter(|tool| !tool.installed)
        .map(|tool| tool.name)
        .collect()
}

fn install_perl(report: &Reporter, root: &Path, downloads: &Path) -> Result<(), String> {
    let zip = downloads.join(PERL_ZIP_NAME);
    download_step(report, PERL_DOWNLOAD, "Downloading Strawberry Perl", PERL_ZIP_URL, &zip, Some(PERL_ZIP_SHA256), Some(PERL_ZIP_SIZE))?;
    let target = root.join(PERL_DIR);
    extract_step(report, PERL_EXTRACT, "Unpacking Strawberry Perl", &zip, &target)?;
    report.attempt(PERL_EXTRACT, "Unpacking Strawberry Perl", || {
        if target.join("perl").join("bin").join("perl.exe").is_file() {
            Ok(())
        } else {
            Err("perl.exe was not found in the unpacked files".into())
        }
    })?;
    // The archive is no longer needed once unpacked and checked; free 300 MB.
    let _ = fs::remove_file(&zip);
    report.done(PERL_EXTRACT, "Strawberry Perl ready", &target.display().to_string());
    Ok(())
}

fn install_miktex(report: &Reporter, root: &Path, downloads: &Path) -> Result<(), String> {
    let zip = downloads.join("miktexsetup-x64.zip");
    download_step(report, MIKTEX_DOWNLOAD, "Downloading MiKTeX setup", MIKTEX_SETUP_URL, &zip, None, None)?;
    let utility = root.join("miktexsetup");
    extract_step(report, MIKTEX_EXTRACT, "Unpacking MiKTeX setup", &zip, &utility)?;
    let setup_exe = report.attempt(MIKTEX_EXTRACT, "Unpacking MiKTeX setup", || {
        find_file_named(&utility, "miktexsetup_standalone.exe").ok_or_else(|| "miktexsetup_standalone.exe was not found in the archive".to_string())
    })?;
    report.done(MIKTEX_EXTRACT, "MiKTeX setup ready", "");

    let repository = format!("--local-package-repository={}", root.join("miktex-repository").display());
    let mut download = Command::new(&setup_exe);
    download.args(["--verbose", &repository, "--package-set=basic", "download"]);
    stream_step(report, MIKTEX_PACKAGES, "Downloading MiKTeX packages", download)?;

    let mut install = Command::new(&setup_exe);
    install.args([
        "--verbose".to_string(),
        repository,
        "--shared=no".into(),
        "--modify-path=no".into(),
        "--package-set=basic".into(),
        format!("--user-install={}", root.join("MiKTeX").display()),
        format!("--user-config={}", root.join("MiKTeXConfig").display()),
        format!("--user-data={}", root.join("MiKTeXData").display()),
        "install".into(),
    ]);
    stream_step(report, MIKTEX_INSTALL, "Installing MiKTeX", install)
}

/// MiKTeX is present but latexmk isn't: add just that package.
fn install_latexmk_package(report: &Reporter, miktex: Option<&str>) -> Result<(), String> {
    let miktex = report.attempt(MIKTEX_PACKAGES, "Installing latexmk", || miktex.map(PathBuf::from).ok_or_else(|| "the MiKTeX program was not found".to_string()))?;
    let mut command = Command::new(miktex);
    command.args(["packages", "install", "latexmk"]);
    report.running(MIKTEX_PACKAGES, "Installing latexmk", "Asking MiKTeX to add the latexmk package.");
    match run_streaming(command, &mut |line| report.log(&format!("  {line}"))) {
        // MiKTeX exits with 1 for "package is already installed"; that is the goal state.
        Err(error) if !error.contains("already installed") => {
            report.error(MIKTEX_PACKAGES, "Installing latexmk failed", &error);
            Err(format!("Installing latexmk failed: {error}"))
        }
        _ => {
            report.done(MIKTEX_PACKAGES, "latexmk installed", "");
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// Steps with progress
// ---------------------------------------------------------------------------

const EMIT_EVERY: Duration = Duration::from_millis(200);

fn download_step(
    report: &Reporter,
    step: Step,
    label: &str,
    url: &str,
    destination: &Path,
    sha256: Option<&str>,
    expected_size: Option<u64>,
) -> Result<(), String> {
    report.running(step, label, &format!("From {}", host_of(url)));
    let started = Instant::now();
    let mut last = Instant::now() - EMIT_EVERY;
    let outcome = report.attempt(step, label, || {
        download(url, destination, sha256, &mut |done, total| {
            let total = total.or(expected_size);
            if last.elapsed() < EMIT_EVERY {
                return;
            }
            last = Instant::now();
            let fraction = total.map_or(0.0, |total| done as f64 / total.max(1) as f64);
            report.advance(step, label, &describe_transfer(done, total, started.elapsed()), fraction, Some((done, total)));
        })
    })?;
    let detail = match outcome {
        Downloaded::Reused => "Using the file downloaded earlier (checksum verified).".to_string(),
        Downloaded::Fresh(bytes) => format!("{} downloaded{}.", format_bytes(bytes), if sha256.is_some() { ", checksum verified" } else { "" }),
    };
    report.done(step, &format!("{label} — done"), &detail);
    Ok(())
}

fn extract_step(report: &Reporter, step: Step, label: &str, zip: &Path, destination: &Path) -> Result<(), String> {
    report.running(step, label, &format!("Into {}", destination.display()));
    let mut last = Instant::now() - EMIT_EVERY;
    report.attempt(step, label, || {
        extract_zip(zip, destination, &mut |done, total| {
            if last.elapsed() < EMIT_EVERY {
                return;
            }
            last = Instant::now();
            let fraction = done as f64 / total.max(1) as f64;
            report.advance(step, label, &format!("{} of {}", format_bytes(done), format_bytes(total)), fraction, Some((done, Some(total))));
        })
    })
}

fn stream_step(report: &Reporter, step: Step, label: &str, command: Command) -> Result<(), String> {
    report.running(step, label, "This can take several minutes.");
    let mut lines = 0u64;
    let mut last = Instant::now() - EMIT_EVERY;
    report.attempt(step, label, || {
        run_streaming(command, &mut |line| {
            lines += 1;
            report.log(&format!("  {line}"));
            if last.elapsed() < EMIT_EVERY {
                return;
            }
            last = Instant::now();
            // No total is known; creep towards the end of the step as output arrives.
            let fraction = 1.0 - 1.0 / (1.0 + lines as f64 / 150.0);
            report.advance(step, label, &shorten(line, 110), fraction, None);
        })
    })?;
    report.done(step, &format!("{label} — done"), "");
    Ok(())
}

// ---------------------------------------------------------------------------
// Download, unzip, streamed processes
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Downloaded {
    Reused,
    Fresh(u64),
}

/// Stream `url` to `destination` via a `.part` file, verifying `sha256` while writing.
/// An existing complete file (verified when a hash is given) is reused.
pub(crate) fn download(
    url: &str,
    destination: &Path,
    sha256: Option<&str>,
    on_progress: &mut dyn FnMut(u64, Option<u64>),
) -> Result<Downloaded, String> {
    if destination.is_file() && sha256.map_or(true, |hash| verify_sha256(destination, Some(hash)).is_ok()) {
        return Ok(Downloaded::Reused);
    }
    let _ = fs::remove_file(destination);

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .tls_config(ureq::tls::TlsConfig::builder().provider(ureq::tls::TlsProvider::NativeTls).build())
        .timeout_connect(Some(Duration::from_secs(30)))
        .timeout_per_read(Some(Duration::from_secs(60)))
        .build()
        .new_agent();
    let mut response = agent.get(url).call().map_err(|error| match error {
        ureq::Error::StatusCode(code) => format!("{} answered HTTP {code}.", host_of(url)),
        other => format!("Could not reach {}. Check your internet connection. ({other})", host_of(url)),
    })?;
    let total = response.body().content_length();

    let part = part_path(destination);
    let result = (|| -> Result<u64, String> {
        let mut file = File::create(&part).map_err(|error| format!("Could not write {}: {error}", part.display()))?;
        let mut reader = response.body_mut().as_reader();
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 256 * 1024];
        let mut done = 0u64;
        on_progress(0, total);
        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|error| format!("The download from {} stopped: {error}", host_of(url)))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read]).map_err(|error| format!("Could not write the download (disk full?): {error}"))?;
            hasher.update(&buffer[..read]);
            done += read as u64;
            on_progress(done, total);
        }
        file.sync_all().map_err(|error| format!("Could not finish writing the download: {error}"))?;
        if let Some(total) = total {
            if done != total {
                return Err(format!("The download ended early ({} of {}).", format_bytes(done), format_bytes(total)));
            }
        }
        if let Some(expected) = sha256 {
            let actual = format!("{:x}", hasher.finalize());
            if !actual.eq_ignore_ascii_case(expected) {
                return Err("The downloaded file was corrupted (checksum mismatch). Lexy deleted it; please try again.".into());
            }
        }
        Ok(done)
    })();

    match result {
        Ok(bytes) => {
            fs::rename(&part, destination).map_err(|error| format!("Could not save the download: {error}"))?;
            Ok(Downloaded::Fresh(bytes))
        }
        Err(error) => {
            let _ = fs::remove_file(&part);
            Err(error)
        }
    }
}

fn part_path(destination: &Path) -> PathBuf {
    let mut name = destination.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    destination.with_file_name(name)
}

/// Unzip into a temporary sibling folder, then swap it in, so a half-extracted
/// folder never looks installed. Entries that would escape the folder are refused.
pub(crate) fn extract_zip(zip: &Path, destination: &Path, on_progress: &mut dyn FnMut(u64, u64)) -> Result<(), String> {
    let file = File::open(zip).map_err(|error| format!("Could not open {}: {error}", zip.display()))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| format!("{} is not a valid ZIP file: {error}", zip.display()))?;

    let total: u64 = (0..archive.len())
        .filter_map(|index| archive.by_index_raw(index).ok().map(|entry| entry.size()))
        .sum();
    let staging = destination.with_file_name(format!(
        "{}.unpacking",
        destination.file_name().unwrap_or_default().to_string_lossy()
    ));
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|error| format!("Could not create {}: {error}", staging.display()))?;

    let result = (|| -> Result<(), String> {
        let mut done = 0u64;
        let mut buffer = vec![0u8; 256 * 1024];
        on_progress(0, total);
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|error| format!("Could not read the ZIP file: {error}"))?;
            let relative = entry
                .enclosed_name()
                .ok_or_else(|| format!("The ZIP file contains an unsafe path: {}", entry.name()))?;
            let target = staging.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&target).map_err(|error| format!("Could not create {}: {error}", target.display()))?;
                continue;
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
            }
            let mut out = File::create(&target).map_err(|error| format!("Could not write {}: {error}", target.display()))?;
            loop {
                let read = entry.read(&mut buffer).map_err(|error| format!("The ZIP file is damaged: {error}"))?;
                if read == 0 {
                    break;
                }
                out.write_all(&buffer[..read]).map_err(|error| format!("Could not write {} (disk full?): {error}", target.display()))?;
                done += read as u64;
                on_progress(done, total);
            }
        }
        Ok(())
    })();

    if let Err(error) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let _ = fs::remove_dir_all(destination);
    fs::rename(&staging, destination).map_err(|error| format!("Could not move the unpacked files into place: {error}"))
}

/// Run a tool, handing every output line (stdout and stderr) to `on_line` as it
/// arrives. On failure the error carries the last few lines instead of "No output."
pub(crate) fn run_streaming(mut command: Command, on_line: &mut dyn FnMut(&str)) -> Result<(), String> {
    let program = Path::new(command.get_program()).file_name().unwrap_or_default().to_string_lossy().into_owned();
    let mut child = hide_console(&mut command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start {program}: {error}"))?;

    let (sender, receiver) = mpsc::channel::<String>();
    let mut readers = Vec::new();
    for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
        .into_iter()
        .flatten()
    {
        let sender = sender.clone();
        readers.push(thread::spawn(move || {
            for line in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
                let text = String::from_utf8_lossy(&line).trim_end_matches('\r').trim().to_string();
                if !text.is_empty() && sender.send(text).is_err() {
                    break;
                }
            }
        }));
    }
    drop(sender);

    let mut tail: Vec<String> = Vec::new();
    for line in receiver {
        on_line(&line);
        tail.push(line);
        if tail.len() > 5 {
            tail.remove(0);
        }
    }
    for reader in readers {
        let _ = reader.join();
    }
    let status = child.wait().map_err(|error| format!("Could not wait for {program}: {error}"))?;
    if status.success() {
        return Ok(());
    }
    let last = if tail.is_empty() { "It printed nothing.".to_string() } else { format!("Last output: {}", tail.join(" | ")) };
    Err(format!("{program} stopped with exit code {}. {last}", status.code().map_or("unknown".into(), |code| code.to_string())))
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

pub(crate) fn host_of(url: &str) -> &str {
    url.split("://").nth(1).unwrap_or(url).split('/').next().unwrap_or(url)
}

/// "45.2 MiB of 290.2 MiB · 6.3 MiB/s · about 40 s left"
pub(crate) fn describe_transfer(done: u64, total: Option<u64>, elapsed: Duration) -> String {
    let seconds = elapsed.as_secs_f64();
    let rate = if seconds >= 0.5 { done as f64 / seconds } else { 0.0 };
    let mut text = match total {
        Some(total) => format!("{} of {}", format_bytes(done), format_bytes(total)),
        None => format_bytes(done),
    };
    if rate > 0.0 {
        text.push_str(&format!(" · {}/s", format_bytes(rate as u64)));
        if let Some(total) = total {
            let left = total.saturating_sub(done) as f64 / rate;
            text.push_str(&format!(" · {}", describe_remaining(left)));
        }
    }
    text
}

fn describe_remaining(seconds: f64) -> String {
    if seconds < 1.0 {
        "almost done".into()
    } else if seconds < 60.0 {
        format!("about {} s left", seconds.ceil() as u64)
    } else if seconds < 3600.0 {
        format!("about {} min left", (seconds / 60.0).ceil() as u64)
    } else {
        "over an hour left".into()
    }
}

pub(crate) fn shorten(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let kept: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{kept}…")
}

/// Last `max_lines` lines of the setup log ("" when there is none yet).
pub(crate) fn log_tail(path: &Path, max_lines: usize) -> String {
    let text = fs::read(path).map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(max_lines)..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("lexy-setup-test-{}-{label}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// One-shot local HTTP server returning `body` with `status`, `requests` times.
    fn serve(status: &'static str, body: Vec<u8>, requests: usize) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            for stream in listener.incoming().take(requests).flatten() {
                let mut stream = stream;
                let mut request = [0u8; 2048];
                let _ = stream.read(&mut request);
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(&body);
            }
        });
        format!("http://{address}/file.zip")
    }

    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    #[test]
    fn download_streams_with_progress_and_verifies_the_hash() {
        let dir = TempDir::new("dl-ok");
        let body: Vec<u8> = (0..700_000u32).map(|i| (i % 251) as u8).collect();
        let url = serve("200 OK", body.clone(), 1);
        let target = dir.0.join("file.zip");
        let mut calls = Vec::new();
        let outcome = download(&url, &target, Some(&sha(&body)), &mut |done, total| calls.push((done, total))).unwrap();
        assert_eq!(outcome, Downloaded::Fresh(700_000));
        assert_eq!(fs::read(&target).unwrap(), body);
        assert_eq!(calls.first(), Some(&(0, Some(700_000))));
        assert_eq!(calls.last(), Some(&(700_000, Some(700_000))));
        assert!(calls.windows(2).all(|w| w[0].0 <= w[1].0));
        assert!(!part_path(&target).exists());
    }

    #[test]
    fn download_rejects_a_corrupted_file_and_leaves_nothing_behind() {
        let dir = TempDir::new("dl-bad");
        let url = serve("200 OK", b"tampered".to_vec(), 1);
        let target = dir.0.join("file.zip");
        let error = download(&url, &target, Some(&sha(b"original")), &mut |_, _| {}).unwrap_err();
        assert!(error.contains("checksum mismatch"), "{error}");
        assert!(!target.exists());
        assert!(!part_path(&target).exists());
    }

    #[test]
    fn download_reports_http_errors_readably() {
        let dir = TempDir::new("dl-404");
        let url = serve("404 Not Found", b"nope".to_vec(), 1);
        let error = download(&url, &dir.0.join("f.zip"), None, &mut |_, _| {}).unwrap_err();
        assert!(error.contains("HTTP 404"), "{error}");
    }

    #[test]
    fn download_reports_unreachable_hosts() {
        let dir = TempDir::new("dl-down");
        // Bind then drop to get a port with nothing listening.
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let error = download(&format!("http://127.0.0.1:{port}/x.zip"), &dir.0.join("x.zip"), None, &mut |_, _| {}).unwrap_err();
        assert!(error.contains("Could not reach 127.0.0.1"), "{error}");
    }

    #[test]
    fn download_reuses_a_verified_earlier_download_without_network() {
        let dir = TempDir::new("dl-reuse");
        let target = dir.0.join("file.zip");
        fs::write(&target, b"complete").unwrap();
        let outcome = download("http://127.0.0.1:9/never", &target, Some(&sha(b"complete")), &mut |_, _| panic!("no progress expected")).unwrap();
        assert_eq!(outcome, Downloaded::Reused);
    }

    #[test]
    fn download_replaces_an_earlier_file_that_fails_the_hash() {
        let dir = TempDir::new("dl-replace");
        let target = dir.0.join("file.zip");
        fs::write(&target, b"stale").unwrap();
        let url = serve("200 OK", b"fresh".to_vec(), 1);
        assert_eq!(download(&url, &target, Some(&sha(b"fresh")), &mut |_, _| {}).unwrap(), Downloaded::Fresh(5));
        assert_eq!(fs::read(&target).unwrap(), b"fresh");
    }

    fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut writer = zip::ZipWriter::new(File::create(path).unwrap());
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            if name.ends_with('/') {
                writer.add_directory(*name, options).unwrap();
            } else {
                writer.start_file(*name, options).unwrap();
                writer.write_all(data).unwrap();
            }
        }
        writer.finish().unwrap();
    }

    #[test]
    fn extract_zip_unpacks_nested_files_with_progress() {
        let dir = TempDir::new("zip-ok");
        let zip = dir.0.join("a.zip");
        let big = vec![7u8; 600_000];
        make_zip(&zip, &[("perl/", b""), ("perl/bin/perl.exe", &big), ("c/bin/gcc.exe", b"gcc"), ("README.txt", b"hi")]);
        let target = dir.0.join("StrawberryPerl");
        let mut calls = Vec::new();
        extract_zip(&zip, &target, &mut |done, total| calls.push((done, total))).unwrap();
        assert_eq!(fs::read(target.join("perl/bin/perl.exe")).unwrap(), big);
        assert_eq!(fs::read_to_string(target.join("README.txt")).unwrap(), "hi");
        let total = 600_000 + 3 + 2;
        assert_eq!(calls.first(), Some(&(0, total)));
        assert_eq!(calls.last(), Some(&(total, total)));
        assert!(!dir.0.join("StrawberryPerl.unpacking").exists());
    }

    #[test]
    fn extract_zip_replaces_an_existing_folder() {
        let dir = TempDir::new("zip-replace");
        let zip = dir.0.join("a.zip");
        make_zip(&zip, &[("new.txt", b"new")]);
        let target = dir.0.join("out");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("old.txt"), b"old").unwrap();
        extract_zip(&zip, &target, &mut |_, _| {}).unwrap();
        assert!(target.join("new.txt").exists());
        assert!(!target.join("old.txt").exists());
    }

    #[test]
    fn extract_zip_refuses_path_traversal_and_cleans_up() {
        let dir = TempDir::new("zip-slip");
        let zip = dir.0.join("evil.zip");
        make_zip(&zip, &[("ok.txt", b"ok"), ("../escaped.txt", b"evil")]);
        let target = dir.0.join("out");
        let error = extract_zip(&zip, &target, &mut |_, _| {}).unwrap_err();
        assert!(error.contains("unsafe path"), "{error}");
        assert!(!dir.0.join("escaped.txt").exists());
        assert!(!target.exists());
        assert!(!dir.0.join("out.unpacking").exists());
    }

    #[test]
    fn extract_zip_reports_a_damaged_archive() {
        let dir = TempDir::new("zip-bad");
        let zip = dir.0.join("bad.zip");
        fs::write(&zip, b"not a zip at all").unwrap();
        assert!(extract_zip(&zip, &dir.0.join("out"), &mut |_, _| {}).unwrap_err().contains("not a valid ZIP"));
    }

    #[cfg(windows)]
    fn cmd(script: &str) -> Command {
        let mut command = Command::new("cmd");
        command.args(["/C", script]);
        command
    }

    #[cfg(windows)]
    #[test]
    fn run_streaming_delivers_stdout_and_stderr_lines_as_they_come() {
        let mut lines = Vec::new();
        run_streaming(cmd("echo one & echo two 1>&2 & echo three"), &mut |line| lines.push(line.to_string())).unwrap();
        lines.sort();
        assert_eq!(lines, vec!["one", "three", "two"]);
    }

    #[cfg(windows)]
    #[test]
    fn run_streaming_failure_includes_the_last_output() {
        let error = run_streaming(cmd("echo preparing & echo disk is full 1>&2 & exit 1603"), &mut |_| {}).unwrap_err();
        assert!(error.contains("exit code 1603"), "{error}");
        assert!(error.contains("disk is full"), "{error}");
    }

    #[cfg(windows)]
    #[test]
    fn run_streaming_says_when_a_tool_printed_nothing() {
        let error = run_streaming(cmd("exit 2"), &mut |_| {}).unwrap_err();
        assert!(error.contains("It printed nothing."), "{error}");
    }

    #[test]
    fn run_streaming_reports_a_missing_program() {
        let error = run_streaming(Command::new("lexy-no-such-setup-tool"), &mut |_| {}).unwrap_err();
        assert!(error.contains("Could not start lexy-no-such-setup-tool"), "{error}");
    }

    #[test]
    fn describe_transfer_shows_size_speed_and_time_left() {
        let mib = 1024 * 1024;
        assert_eq!(describe_transfer(45 * mib, Some(290 * mib), Duration::from_secs(9)), "45.0 MiB of 290.0 MiB · 5.0 MiB/s · about 49 s left");
        assert_eq!(describe_transfer(10 * mib, Some(1000 * mib), Duration::from_secs(10)), "10.0 MiB of 1000.0 MiB · 1.0 MiB/s · about 17 min left");
        assert_eq!(describe_transfer(5 * mib, None, Duration::from_secs(5)), "5.0 MiB · 1.0 MiB/s");
        assert_eq!(describe_transfer(0, Some(mib), Duration::from_millis(100)), "0 bytes of 1.0 MiB");
        assert_eq!(describe_transfer(mib, Some(mib), Duration::from_secs(1)), "1.0 MiB of 1.0 MiB · 1.0 MiB/s · almost done");
    }

    #[test]
    fn host_and_shorten_helpers() {
        assert_eq!(host_of(PERL_ZIP_URL), "github.com");
        assert_eq!(host_of("https://miktex.org/download/win/x.zip"), "miktex.org");
        assert_eq!(shorten("short", 10), "short");
        assert_eq!(shorten("abcdefghijkl", 6), "abcde…");
    }

    #[test]
    fn steps_cover_0_to_100_without_gaps() {
        let steps = [CHECK, PERL_DOWNLOAD, PERL_EXTRACT, MIKTEX_DOWNLOAD, MIKTEX_EXTRACT, MIKTEX_PACKAGES, MIKTEX_INSTALL, VERIFY];
        assert_eq!(steps[0].start, 0);
        assert_eq!(steps[steps.len() - 1].end, 100);
        for pair in steps.windows(2) {
            assert_eq!(pair[0].end, pair[1].start, "{} → {}", pair[0].id, pair[1].id);
        }
    }

    #[test]
    fn reporter_maps_step_fractions_to_overall_progress_and_logs() {
        let dir = TempDir::new("reporter");
        let log = dir.0.join("setup.log");
        let events = Mutex::new(Vec::new());
        let emit = |event: SetupProgress| events.lock().unwrap().push(event);
        let report = Reporter::new(&emit, Some(&log));
        report.running(PERL_DOWNLOAD, "Downloading", "");
        report.advance(PERL_DOWNLOAD, "Downloading", "half", 0.5, Some((50, Some(100))));
        report.done(PERL_DOWNLOAD, "Downloaded", "ok");
        report.skipped(MIKTEX_DOWNLOAD, "Not needed", "");
        let result: Result<(), String> = report.attempt(VERIFY, "Verifying", || Err("perl missing".into()));
        assert_eq!(result.unwrap_err(), "Verifying failed: perl missing");

        let events = events.into_inner().unwrap();
        let summary: Vec<_> = events.iter().map(|e| (e.step, e.state, e.progress)).collect();
        assert_eq!(
            summary,
            vec![
                ("perl-download", "running", 2),
                ("perl-download", "running", 26),
                ("perl-download", "done", 50),
                ("miktex-download", "skipped", 65),
                ("verify", "error", 96),
            ]
        );
        assert_eq!((events[1].bytes_done, events[1].bytes_total), (Some(50), Some(100)));
        assert_eq!(events[4].detail, "perl missing");

        let text = fs::read_to_string(&log).unwrap();
        assert!(text.contains("perl-download done: Downloaded — ok"));
        assert!(text.contains("verify error: Verifying failed — perl missing"));
        assert!(!text.contains("half"), "byte ticks are not logged");
        assert_eq!(log_tail(&log, 2).lines().count(), 2);
    }

    #[test]
    fn setup_progress_serializes_camel_case() {
        let json = serde_json::to_value(SetupProgress {
            step: "perl-download",
            state: "running",
            label: "Downloading".into(),
            detail: String::new(),
            progress: 10,
            bytes_done: Some(5),
            bytes_total: None,
        })
        .unwrap();
        assert_eq!(json["bytesDone"], 5);
        assert!(json["bytesTotal"].is_null());
        assert_eq!(json["state"], "running");
    }

    fn tool(name: &'static str, installed: bool, on_disk: bool) -> crate::ToolProbe {
        crate::ToolProbe {
            name,
            installed,
            version: None,
            path: on_disk.then(|| format!(r"C:\x\{name}.exe")),
            message: String::new(),
        }
    }

    fn environment(miktex: (bool, bool), latexmk: (bool, bool)) -> EnvironmentStatus {
        EnvironmentStatus {
            ready: false,
            miktex: tool("MiKTeX", miktex.0, miktex.1),
            latexmk: tool("latexmk", latexmk.0, latexmk.1),
            perl: tool("Strawberry Perl", false, false),
        }
    }

    #[test]
    fn miktex_plan_follows_what_is_on_disk() {
        // MiKTeX missing: full per-user install.
        assert_eq!(miktex_plan(&environment((false, false), (false, false))), MiktexPlan::Full);
        // latexmk.exe present but failing because Perl is missing: installing Perl is enough.
        assert_eq!(miktex_plan(&environment((true, true), (false, true))), MiktexPlan::Nothing);
        // latexmk really absent from MiKTeX: add just that package.
        assert_eq!(miktex_plan(&environment((true, true), (false, false))), MiktexPlan::LatexmkPackage);
        assert_eq!(miktex_plan(&environment((true, true), (true, true))), MiktexPlan::Nothing);
    }

    #[test]
    fn log_tail_handles_a_missing_log() {
        assert_eq!(log_tail(Path::new("Z:/definitely/missing.log"), 10), "");
    }
}
