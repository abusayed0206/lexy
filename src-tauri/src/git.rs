//! Git version control for the open project (specs/006-git-integration). Lexy runs the
//! user's Git for Windows (and GitHub CLI for Publish); Git's credential manager and gh's
//! browser sign-in handle every secret, so Lexy never sees a password or token.

use serde::Serialize;
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

use crate::{
    find_on_path, hide_console, kill_tree,
    project::{display_path, resolve_in_project, ErrorKind, ProjectError, ProjectState},
    run_with_timeout, ProcessOutput,
};

const LOCAL: Duration = Duration::from_secs(30);
const NETWORK: Duration = Duration::from_secs(120);
const SIGN_IN: Duration = Duration::from_secs(300);
const LARGE_FILE: u64 = 50 * 1024 * 1024;
const FIRST_COMMIT: &str = "Start Lexy project";
const IGNORED: [&str; 18] = [
    "*.aux", "*.log", "*.out", "*.toc", "*.lof", "*.lot", "*.fls", "*.fdb_latexmk", "*.synctex.gz", "*.synctex(busy)",
    "*.bbl", "*.blg", "*.bcf", "*.run.xml", "*.xdv", "*.nav", "*.snm", "*.vrb",
];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitErrorKind {
    NotInstalled,
    GhNotInstalled,
    NoRepo,
    NeedsIdentity,
    EmptyMessage,
    NothingToCommit,
    LargeFiles,
    Dirty,
    Rejected,
    Conflict,
    Network,
    Auth,
    BadUrl,
    ReadOnly,
    Busy,
    Failed,
}
use GitErrorKind as K;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GitError {
    pub kind: GitErrorKind,
    pub message: String,
}

fn err(kind: GitErrorKind, message: impl Into<String>) -> GitError {
    GitError { kind, message: message.into() }
}

impl From<ProjectError> for GitError {
    fn from(error: ProjectError) -> Self {
        let kind = if error.kind == ErrorKind::ReadOnly { K::ReadOnly } else { K::Failed };
        err(kind, error.message)
    }
}

type Result<T> = std::result::Result<T, GitError>;

/// Map Git's (English, `LC_ALL=C`) stderr to the kinds the UI branches on.
fn classify_stderr(stderr: &str) -> GitError {
    let lower = stderr.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|needle| lower.contains(needle));
    if has(&["[rejected]", "fetch first", "non-fast-forward"]) {
        err(K::Rejected, "Someone else pushed changes. Pull first.")
    } else if has(&["could not resolve host", "timed out", "unable to access", "could not connect", "connection refused", "network is unreachable"]) {
        err(K::Network, "Could not reach the server. Your commits are safe here.")
    } else if has(&["authentication failed", "could not read username", "permission denied", "terminal prompts disabled", "403"]) {
        err(K::Auth, "Sign-in failed or was cancelled.")
    } else {
        let tail: Vec<&str> = stderr.lines().filter(|line| !line.trim().is_empty()).collect();
        let tail = tail[tail.len().saturating_sub(5)..].join("\n");
        err(K::Failed, if tail.is_empty() { "Git failed".to_string() } else { tail })
    }
}

// ---------------------------------------------------------------------------
// Running git
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct GitLock(Arc<Mutex<()>>);

fn find_tool(name: &str, fallbacks: &[(&str, &str)]) -> Option<PathBuf> {
    find_on_path(name).or_else(|| {
        fallbacks
            .iter()
            .filter_map(|(var, rel)| std::env::var_os(var).map(|base| PathBuf::from(base).join(rel)))
            .find(|path| path.is_file())
    })
}

fn find_git() -> Option<PathBuf> {
    find_tool("git.exe", &[("ProgramFiles", r"Git\cmd\git.exe"), ("LOCALAPPDATA", r"Programs\Git\cmd\git.exe")])
}

fn find_gh() -> Option<PathBuf> {
    find_tool("gh.exe", &[("ProgramFiles", r"GitHub CLI\gh.exe"), ("LOCALAPPDATA", r"Programs\GitHub CLI\gh.exe")])
}

/// Everything a git call needs, copied out of `ProjectState` so work runs off the main thread.
pub struct Ctx {
    git: PathBuf,
    root: PathBuf,
    main: Option<String>,
    /// Extra environment; tests point `GIT_CONFIG_GLOBAL` at a scratch file.
    env: Vec<(String, String)>,
}

impl Ctx {
    fn new(state: &ProjectState, write: bool) -> Result<Self> {
        let (root, main, read_only) = state.with(|p| Ok((p.root.clone(), p.main.clone(), p.read_only)))?;
        if write && read_only {
            return Err(err(K::ReadOnly, "This project is open in another Lexy window."));
        }
        let git = find_git().ok_or_else(|| err(K::NotInstalled, "Git for Windows is needed for version history."))?;
        Ok(Self { git, root, main, env: Vec::new() })
    }

    fn command(&self, program: &Path, args: &[&str]) -> Command {
        let mut command = Command::new(program);
        command
            .current_dir(display_path(&self.root))
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GH_NO_UPDATE_NOTIFIER", "1")
            .env("GH_PROMPT_DISABLED", "1")
            .env("LC_ALL", "C");
        if program == self.git {
            command.args(["-c", "core.quotepath=false", "-c", "color.ui=false"]);
        }
        command.args(args).envs(self.env.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        command
    }

    fn run(&self, args: &[&str], timeout: Duration) -> Result<ProcessOutput> {
        run_with_timeout(self.command(&self.git, args), timeout, &|| false).map_err(|message| err(K::Failed, message))
    }

    /// Run and require success; failures are classified.
    fn ok(&self, args: &[&str], timeout: Duration) -> Result<String> {
        let output = self.run(args, timeout)?;
        if output.timed_out {
            return Err(err(K::Network, "Git took too long and was stopped. Your commits are safe here."));
        }
        if output.success {
            Ok(output.stdout)
        } else {
            Err(classify_stderr(&output.stderr))
        }
    }

    fn rel(&self, path: &str) -> Result<String> {
        resolve_in_project(&self.root, path)?;
        Ok(path.replace('\\', "/"))
    }
}

fn locked<T>(lock: &Arc<Mutex<()>>, run: impl FnOnce() -> Result<T>) -> Result<T> {
    let _guard = lock.try_lock().map_err(|_| err(K::Busy, "Another Git action is still running."))?;
    run()
}

async fn blocking<T: Send + 'static>(run: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(run).await.map_err(|error| err(K::Failed, format!("task failed: {error}")))?
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

fn valid_commit(id: &str) -> Result<()> {
    let ok = (7..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if ok { Ok(()) } else { Err(err(K::Failed, format!("not a commit id: {id}"))) }
}

fn valid_url(url: &str) -> bool {
    let scp = url.split_once(':').is_some_and(|(host, path)| host.contains('@') && !host.contains('/') && !path.is_empty());
    !url.is_empty()
        && !url.starts_with('-')
        && !url.chars().any(char::is_whitespace)
        && (url.starts_with("https://") || url.starts_with("ssh://") || scp)
}

fn valid_repo_name(name: &str) -> bool {
    (1..=100).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub old_path: Option<String>,
    pub status: &'static str,
    pub size: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitState {
    pub installed: bool,
    pub repo: &'static str,
    pub repo_root: Option<String>,
    pub branch: Option<String>,
    pub remote_url: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<Change>,
    pub merging: bool,
    pub read_only: bool,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Parsed {
    branch: Option<String>,
    upstream: bool,
    ahead: u32,
    behind: u32,
    changes: Vec<Change>,
}

fn change_status(xy: &str) -> &'static str {
    if xy.contains('D') {
        "deleted"
    } else if xy.contains('A') {
        "added"
    } else if xy.contains('R') || xy.contains('C') {
        "renamed"
    } else {
        "modified"
    }
}

/// Parse `git status --porcelain=v2 --branch -z`. Paths are repo-relative; keep those under
/// `prefix` (the project folder inside the repo) and make them project-relative.
fn parse_status_v2(text: &str, prefix: &str) -> Parsed {
    let mut parsed = Parsed::default();
    let strip = |path: &str| path.strip_prefix(prefix).map(str::to_string);
    let mut records = text.split('\0');
    while let Some(record) = records.next() {
        let (kind, rest) = record.split_at(record.find(' ').unwrap_or(record.len()));
        let rest = rest.trim_start();
        let fields = |n: usize| rest.splitn(n, ' ').collect::<Vec<_>>();
        let (path, old, status) = match kind {
            "#" => {
                if let Some(head) = rest.strip_prefix("branch.head ") {
                    parsed.branch = (head != "(detached)").then(|| head.to_string());
                } else if rest.starts_with("branch.upstream ") {
                    parsed.upstream = true;
                } else if let Some(ab) = rest.strip_prefix("branch.ab ") {
                    let mut parts = ab.split(' ').map(|n| n.trim_start_matches(['+', '-']).parse().unwrap_or(0));
                    parsed.ahead = parts.next().unwrap_or(0);
                    parsed.behind = parts.next().unwrap_or(0);
                }
                continue;
            }
            "1" => {
                let f = fields(8);
                (f.get(7).copied(), None, change_status(f.first().copied().unwrap_or("")))
            }
            "2" => {
                let f = fields(9);
                (f.get(8).copied(), records.next(), "renamed")
            }
            "u" => (fields(10).get(9).copied(), None, "conflicted"),
            "?" => (Some(rest), None, "added"),
            _ => continue,
        };
        if let Some(path) = path.and_then(strip) {
            parsed.changes.push(Change { path, old_path: old.and_then(strip), status, size: None });
        }
    }
    parsed
}

/// Repo top and the project's prefix inside it (`""` when the project is the repo); `None` without a repo.
fn locate(ctx: &Ctx) -> Result<Option<(String, String)>> {
    let output = ctx.run(&["rev-parse", "--show-toplevel", "--show-prefix"], LOCAL)?;
    if !output.success {
        return if output.stderr.contains("not a git repository") { Ok(None) } else { Err(classify_stderr(&output.stderr)) };
    }
    let mut lines = output.stdout.lines();
    let top = lines.next().unwrap_or("").to_string();
    Ok(Some((top, lines.next().unwrap_or("").to_string())))
}

fn status_at(ctx: &Ctx, fetch: bool) -> Result<GitState> {
    let Some((top, prefix)) = locate(ctx)? else {
        return Ok(GitState { installed: true, repo: "none", ..Default::default() });
    };
    let remote_url = ctx.run(&["remote", "get-url", "origin"], LOCAL)?;
    let remote_url = remote_url.success.then(|| remote_url.stdout.trim().to_string());
    if fetch && remote_url.is_some() {
        let _ = ctx.run(&["fetch", "--quiet", "origin"], LOCAL);
    }
    let text = ctx.ok(&["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all", "--", "."], LOCAL)?;
    let mut parsed = parse_status_v2(&text, &prefix);
    for change in &mut parsed.changes {
        change.size = fs::metadata(ctx.root.join(&change.path)).ok().filter(|m| m.is_file()).map(|m| m.len());
    }
    let merging = ctx.run(&["rev-parse", "-q", "--verify", "MERGE_HEAD"], LOCAL)?.success;
    Ok(GitState {
        installed: true,
        repo: if prefix.is_empty() { "own" } else { "parent" },
        repo_root: (!prefix.is_empty()).then(|| top.replace('/', "\\")),
        branch: parsed.branch,
        remote_url,
        ahead: parsed.ahead,
        behind: parsed.behind,
        changes: parsed.changes,
        merging,
        read_only: false,
    })
}

fn require_repo(ctx: &Ctx) -> Result<GitState> {
    let state = status_at(ctx, false)?;
    if state.repo == "none" {
        return Err(err(K::NoRepo, "This project has no version history yet."));
    }
    Ok(state)
}

#[tauri::command]
pub async fn git_status(state: State<'_, ProjectState>, fetch: Option<bool>) -> Result<GitState> {
    let read_only = state.with(|p| Ok(p.read_only))?;
    let ctx = match Ctx::new(&state, false) {
        Err(error) if error.kind == K::NotInstalled => return Ok(GitState { read_only, ..Default::default() }),
        other => other?,
    };
    blocking(move || Ok(GitState { read_only, ..status_at(&ctx, fetch.unwrap_or(false))? })).await
}

// ---------------------------------------------------------------------------
// Init, identity, commit, ignore (Batch A)
// ---------------------------------------------------------------------------

fn has_identity(ctx: &Ctx) -> Result<bool> {
    let get = |key| ctx.run(&["config", key], LOCAL).map(|o| o.success && !o.stdout.trim().is_empty());
    Ok(get("user.name")? && get("user.email")?)
}

fn add_ignore_lines(root: &Path, lines: &[String]) -> Result<()> {
    let path = root.join(".gitignore");
    let mut text = fs::read_to_string(&path).unwrap_or_default();
    let existing: Vec<String> = text.lines().map(|l| l.trim().to_string()).collect();
    let missing: Vec<&String> = lines.iter().filter(|line| !existing.contains(line)).collect();
    if missing.is_empty() {
        return Ok(());
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    for line in missing {
        text.push_str(line);
        text.push('\n');
    }
    fs::write(&path, text).map_err(|error| err(K::Failed, format!("failed to write .gitignore: {error}")))
}

fn init_at(ctx: &Ctx) -> Result<GitState> {
    if let Some((top, _)) = locate(ctx)? {
        return Err(err(K::Failed, format!("This project already has history in {top}.")));
    }
    if !has_identity(ctx)? {
        return Err(err(K::NeedsIdentity, "Git needs your name and email for commits."));
    }
    let mut lines: Vec<String> = IGNORED.iter().map(|s| s.to_string()).collect();
    if let Some(stem) = ctx.main.as_deref().and_then(|main| main.strip_suffix(".tex")) {
        lines.push(format!("/{}.pdf", stem.replace('\\', "/")));
    }
    add_ignore_lines(&ctx.root, &lines)?;
    ctx.ok(&["init", "-q", "-b", "main"], LOCAL)?;
    ctx.ok(&["add", "-A", "--", "."], LOCAL)?;
    ctx.ok(&["commit", "-q", "-m", FIRST_COMMIT], LOCAL)?;
    status_at(ctx, false)
}

#[tauri::command]
pub async fn git_init(state: State<'_, ProjectState>, lock: State<'_, GitLock>) -> Result<GitState> {
    let (ctx, lock) = (Ctx::new(&state, true)?, lock.0.clone());
    blocking(move || locked(&lock, || init_at(&ctx))).await
}

fn set_identity_at(ctx: &Ctx, name: &str, email: &str) -> Result<()> {
    let (name, email) = (name.trim(), email.trim());
    if name.is_empty() || !email.contains('@') {
        return Err(err(K::NeedsIdentity, "Enter a name and an email address."));
    }
    for (key, value) in [("user.name", name), ("user.email", email)] {
        let current = ctx.run(&["config", "--global", key], LOCAL)?;
        if !current.success || current.stdout.trim().is_empty() {
            ctx.ok(&["config", "--global", key, value], LOCAL)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn git_set_identity(state: State<'_, ProjectState>, name: String, email: String) -> Result<()> {
    let ctx = Ctx::new(&state, false)?;
    blocking(move || set_identity_at(&ctx, &name, &email)).await
}

#[derive(Debug, Serialize)]
pub struct Committed {
    pub id: String,
    pub message: String,
}

fn commit_at(ctx: &Ctx, message: &str, allow_large: bool) -> Result<Committed> {
    let message = message.trim();
    if message.is_empty() {
        return Err(err(K::EmptyMessage, "Write a short message first."));
    }
    let state = require_repo(ctx)?;
    if state.changes.is_empty() && !state.merging {
        return Err(err(K::NothingToCommit, "Nothing to commit."));
    }
    if state.changes.iter().any(|c| c.status == "conflicted") {
        return Err(err(K::Conflict, "Resolve the conflicts first."));
    }
    let large: Vec<&str> = state
        .changes
        .iter()
        .filter(|c| c.status != "deleted" && c.size.unwrap_or(0) > LARGE_FILE)
        .map(|c| c.path.as_str())
        .collect();
    if !large.is_empty() && !allow_large {
        return Err(err(K::LargeFiles, large.join("\n")));
    }
    if !has_identity(ctx)? {
        return Err(err(K::NeedsIdentity, "Git needs your name and email for commits."));
    }
    ctx.ok(&["add", "-A", "--", "."], LOCAL)?;
    // Partial commits are refused during a merge; otherwise `-- .` keeps a parent repo's other files out.
    let mut args = vec!["commit", "-q", "-m", message];
    if !state.merging {
        args.extend(["--", "."]);
    }
    ctx.ok(&args, LOCAL)?;
    let id = ctx.ok(&["rev-parse", "HEAD"], LOCAL)?.trim().to_string();
    Ok(Committed { id, message: message.to_string() })
}

#[tauri::command]
pub async fn git_commit(
    state: State<'_, ProjectState>,
    lock: State<'_, GitLock>,
    message: String,
    allow_large: bool,
) -> Result<Committed> {
    let (ctx, lock) = (Ctx::new(&state, true)?, lock.0.clone());
    blocking(move || locked(&lock, || commit_at(&ctx, &message, allow_large))).await
}

#[tauri::command]
pub async fn git_ignore(state: State<'_, ProjectState>, paths: Vec<String>) -> Result<()> {
    let ctx = Ctx::new(&state, true)?;
    let lines = paths.iter().map(|p| ctx.rel(p).map(|rel| format!("/{rel}"))).collect::<Result<Vec<_>>>()?;
    blocking(move || add_ignore_lines(&ctx.root, &lines)).await
}

// ---------------------------------------------------------------------------
// Diff, history, restore (Batch B)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub binary: bool,
    pub old_size: Option<u64>,
    pub new_size: Option<u64>,
    pub patch: String,
}

fn diff_at(ctx: &Ctx, path: &str, commit: Option<&str>) -> Result<FileDiff> {
    let rel = ctx.rel(path)?;
    require_repo(ctx)?;
    if let Some(id) = commit {
        valid_commit(id)?;
    }
    let base = commit.unwrap_or("HEAD");
    let has_base = ctx.run(&["rev-parse", "-q", "--verify", &format!("{base}^{{commit}}")], LOCAL)?.success;
    let tracked = has_base && ctx.run(&["cat-file", "-e", &format!("{base}:./{rel}")], LOCAL)?.success;
    let common = ["--no-ext-diff", "--no-color", "--ignore-cr-at-eol", "-U3"];
    let run_diff = |extra: &[&str]| -> Result<String> {
        let mut args = vec!["diff"];
        args.extend(common);
        args.extend(extra);
        let output = ctx.run(&args, LOCAL)?;
        // `--no-index` exits 1 when files differ.
        if output.success || output.code == Some(1) { Ok(output.stdout) } else { Err(classify_stderr(&output.stderr)) }
    };
    let target = [base, "--", rel.as_str()];
    let untracked = ["--no-index", "--", "/dev/null", rel.as_str()];
    let (numstat, patch) = if tracked {
        (run_diff(&[&["--numstat"][..], &target[..]].concat())?, run_diff(&target)?)
    } else if ctx.root.join(&rel).is_file() {
        (run_diff(&[&["--numstat"][..], &untracked[..]].concat())?, run_diff(&untracked)?)
    } else {
        (String::new(), String::new())
    };
    let new_size = fs::metadata(ctx.root.join(&rel)).ok().map(|m| m.len());
    if numstat.starts_with("-\t-\t") {
        let old_size = if tracked {
            ctx.ok(&["cat-file", "-s", &format!("{base}:./{rel}")], LOCAL)?.trim().parse().ok()
        } else {
            None
        };
        return Ok(FileDiff { binary: true, old_size, new_size, patch: String::new() });
    }
    Ok(FileDiff { patch, ..Default::default() })
}

#[tauri::command]
pub async fn git_diff(state: State<'_, ProjectState>, path: String, commit: Option<String>) -> Result<FileDiff> {
    let ctx = Ctx::new(&state, false)?;
    blocking(move || diff_at(&ctx, &path, commit.as_deref())).await
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct CommitInfo {
    pub id: String,
    pub message: String,
    pub author: String,
    pub time: u64,
    pub files: u32,
}

fn parse_log(text: &str) -> Vec<CommitInfo> {
    text.split('\u{1e}')
        .filter_map(|record| {
            let (head, stat) = record.split_once('\n').unwrap_or((record, ""));
            let mut f = head.split('\u{1f}');
            let (id, author, time, message) = (f.next()?, f.next()?, f.next()?, f.next().unwrap_or(""));
            let files = stat.split_whitespace().next().and_then(|n| n.parse().ok()).unwrap_or(0);
            Some(CommitInfo {
                id: id.to_string(),
                message: message.to_string(),
                author: author.to_string(),
                time: time.parse().unwrap_or(0),
                files,
            })
        })
        .collect()
}

fn log_at(ctx: &Ctx, skip: u32, limit: u32) -> Result<Vec<CommitInfo>> {
    require_repo(ctx)?;
    let output = ctx.run(
        &[
            "log",
            "--diff-merges=first-parent",
            "--shortstat",
            "--format=%x1e%H%x1f%an%x1f%at%x1f%s",
            &format!("--skip={skip}"),
            &format!("--max-count={}", limit.clamp(1, 200)),
            "--",
            ".",
        ],
        LOCAL,
    )?;
    // A repo without commits yet has no history to show.
    if !output.success {
        return if output.stderr.contains("does not have any commits") { Ok(Vec::new()) } else { Err(classify_stderr(&output.stderr)) };
    }
    Ok(parse_log(&output.stdout))
}

#[tauri::command]
pub async fn git_log(state: State<'_, ProjectState>, skip: u32, limit: u32) -> Result<Vec<CommitInfo>> {
    let ctx = Ctx::new(&state, false)?;
    blocking(move || log_at(&ctx, skip, limit)).await
}

fn parse_name_status(text: &str, prefix: &str) -> Vec<Change> {
    let mut changes = Vec::new();
    let mut fields = text.split('\0').filter(|f| !f.is_empty());
    let strip = |path: &str| path.strip_prefix(prefix).map(str::to_string);
    while let Some(code) = fields.next() {
        let renamed = code.starts_with('R') || code.starts_with('C');
        let old = if renamed { fields.next() } else { None };
        let Some(path) = fields.next().and_then(strip) else { continue };
        let status = match code.chars().next() {
            Some('A') => "added",
            Some('D') => "deleted",
            Some('R' | 'C') => "renamed",
            _ => "modified",
        };
        changes.push(Change { path, old_path: old.and_then(strip), status, size: None });
    }
    changes
}

fn log_files_at(ctx: &Ctx, commit: &str) -> Result<Vec<Change>> {
    valid_commit(commit)?;
    let (_, prefix) = locate(ctx)?.ok_or_else(|| err(K::NoRepo, "This project has no version history yet."))?;
    let text = ctx.ok(&["show", "--diff-merges=first-parent", "--name-status", "-z", "-M", "--format=", commit, "--", "."], LOCAL)?;
    Ok(parse_name_status(&text, &prefix))
}

#[tauri::command]
pub async fn git_log_files(state: State<'_, ProjectState>, commit: String) -> Result<Vec<Change>> {
    let ctx = Ctx::new(&state, false)?;
    blocking(move || log_files_at(&ctx, &commit)).await
}

fn show_file_at(ctx: &Ctx, commit: &str, path: &str) -> Result<String> {
    valid_commit(commit)?;
    let rel = ctx.rel(path)?;
    let text = ctx.ok(&["show", &format!("{commit}:./{rel}")], LOCAL)?;
    if text.contains('\0') {
        return Err(err(K::Failed, "This is a binary file."));
    }
    Ok(text)
}

#[tauri::command]
pub async fn git_show_file(state: State<'_, ProjectState>, commit: String, path: String) -> Result<String> {
    let ctx = Ctx::new(&state, false)?;
    blocking(move || show_file_at(&ctx, &commit, &path)).await
}

/// Restore leaves the index and history alone, so the result is ordinary uncommitted changes.
fn restore_at(ctx: &Ctx, commit: &str, path: Option<&str>) -> Result<()> {
    valid_commit(commit)?;
    let target = match path {
        Some(path) => ctx.rel(path)?,
        None => ".".to_string(),
    };
    require_repo(ctx)?;
    ctx.ok(&["restore", &format!("--source={commit}"), "--worktree", "--", &target], LOCAL)?;
    Ok(())
}

#[tauri::command]
pub async fn git_restore(
    state: State<'_, ProjectState>,
    lock: State<'_, GitLock>,
    commit: String,
    path: Option<String>,
) -> Result<()> {
    let (ctx, lock) = (Ctx::new(&state, true)?, lock.0.clone());
    blocking(move || locked(&lock, || restore_at(&ctx, &commit, path.as_deref()))).await
}

// ---------------------------------------------------------------------------
// Remote (Batch C)
// ---------------------------------------------------------------------------

fn connect_at(ctx: &Ctx, url: &str) -> Result<GitState> {
    let url = url.trim();
    if !valid_url(url) {
        return Err(err(K::BadUrl, "Use an https:// or ssh address of a Git repository."));
    }
    let state = require_repo(ctx)?;
    match &state.remote_url {
        Some(_) => ctx.ok(&["remote", "set-url", "origin", url], LOCAL)?,
        None => ctx.ok(&["remote", "add", "origin", url], LOCAL)?,
    };
    if let Err(error) = ctx.ok(&["ls-remote", "origin"], NETWORK) {
        let _ = match &state.remote_url {
            Some(old) => ctx.run(&["remote", "set-url", "origin", old], LOCAL),
            None => ctx.run(&["remote", "remove", "origin"], LOCAL),
        };
        return Err(error);
    }
    status_at(ctx, false)
}

#[tauri::command]
pub async fn git_connect_remote(state: State<'_, ProjectState>, lock: State<'_, GitLock>, url: String) -> Result<GitState> {
    let (ctx, lock) = (Ctx::new(&state, true)?, lock.0.clone());
    blocking(move || locked(&lock, || connect_at(&ctx, &url))).await
}

/// `https://github.com/u/r.git` or `git@github.com:u/r.git` → `https://github.com/u/r`.
fn web_link(url: &str) -> String {
    let url = url.trim().trim_end_matches(".git");
    match url.strip_prefix("git@").and_then(|rest| rest.split_once(':')) {
        Some((host, path)) => format!("https://{host}/{path}"),
        None => url.to_string(),
    }
}

/// `gh auth login --web` prints a one-time code, then waits for the browser sign-in.
fn gh_sign_in(ctx: &Ctx, gh: &Path, app: &AppHandle) -> Result<()> {
    let mut command = ctx.command(gh, &["auth", "login", "--web", "--git-protocol", "https", "--hostname", "github.com"]);
    let mut child = hide_console(&mut command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| err(K::Failed, format!("failed to start GitHub CLI: {error}")))?;
    let output = Arc::new(Mutex::new(String::new()));
    let readers: Vec<_> = [child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|s| Box::new(s) as _)]
        .into_iter()
        .flatten()
        .map(|stream| {
            let (app, output) = (app.clone(), output.clone());
            thread::spawn(move || {
                for line in BufReader::new(stream).lines().map_while(std::result::Result::ok) {
                    if let Some(code) = line.split("one-time code:").nth(1) {
                        let _ = app.emit("git-sign-in", serde_json::json!({ "code": code.trim(), "url": "https://github.com/login/device" }));
                    }
                    if let Ok(mut all) = output.lock() {
                        all.push_str(&line);
                        all.push('\n');
                    }
                }
            })
        })
        .collect();
    let deadline = Instant::now() + SIGN_IN;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(200)),
            _ => {
                kill_tree(&mut child);
                break None;
            }
        }
    };
    for reader in readers {
        let _ = reader.join();
    }
    if status.is_some_and(|s| s.success()) {
        Ok(())
    } else {
        let text = output.lock().map(|t| t.clone()).unwrap_or_default();
        Err(err(K::Auth, format!("GitHub sign-in did not finish.\n{}", text.lines().last().unwrap_or(""))))
    }
}

fn publish_at(ctx: &Ctx, app: &AppHandle, name: &str, private: bool) -> Result<String> {
    if !valid_repo_name(name) {
        return Err(err(K::BadUrl, "Use letters, digits, dots, dashes or underscores for the name."));
    }
    let gh = find_gh().ok_or_else(|| err(K::GhNotInstalled, "Publishing needs GitHub CLI."))?;
    let (top, _) = locate(ctx)?.ok_or_else(|| err(K::NoRepo, "This project has no version history yet."))?;
    let signed_in = run_with_timeout(ctx.command(&gh, &["auth", "status", "--hostname", "github.com"]), LOCAL, &|| false)
        .map_err(|message| err(K::Failed, message))?;
    if !signed_in.success {
        gh_sign_in(ctx, &gh, app)?;
    }
    let visibility = if private { "--private" } else { "--public" };
    let created =
        run_with_timeout(ctx.command(&gh, &["repo", "create", name, visibility, "--source", &top, "--remote", "origin", "--push"]), NETWORK, &|| false)
            .map_err(|message| err(K::Failed, message))?;
    if !created.success {
        return Err(classify_stderr(&created.stderr));
    }
    Ok(web_link(&ctx.ok(&["remote", "get-url", "origin"], LOCAL)?))
}

#[derive(Debug, Serialize)]
pub struct Published {
    pub url: String,
}

#[tauri::command]
pub async fn git_publish_github(
    app: AppHandle,
    state: State<'_, ProjectState>,
    lock: State<'_, GitLock>,
    name: String,
    private: bool,
) -> Result<Published> {
    let (ctx, lock) = (Ctx::new(&state, true)?, lock.0.clone());
    blocking(move || locked(&lock, || publish_at(&ctx, &app, &name, private).map(|url| Published { url }))).await
}

fn push_at(ctx: &Ctx) -> Result<u32> {
    let state = status_at(ctx, false)?;
    if state.remote_url.is_none() {
        return Err(err(K::Failed, "Connect a repository first."));
    }
    let upstream = ctx.run(&["rev-parse", "-q", "--verify", "@{upstream}"], LOCAL)?.success;
    let pushed = if upstream { state.ahead } else { ctx.ok(&["rev-list", "--count", "HEAD"], LOCAL)?.trim().parse().unwrap_or(0) };
    ctx.ok(&["push", "-u", "origin", "HEAD"], NETWORK)?;
    Ok(pushed)
}

#[derive(Debug, Serialize)]
pub struct Pushed {
    pub pushed: u32,
}

#[tauri::command]
pub async fn git_push(state: State<'_, ProjectState>, lock: State<'_, GitLock>) -> Result<Pushed> {
    let (ctx, lock) = (Ctx::new(&state, true)?, lock.0.clone());
    blocking(move || locked(&lock, || push_at(&ctx).map(|pushed| Pushed { pushed }))).await
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct Pulled {
    pub pulled: u32,
    pub conflicts: Vec<String>,
}

fn pull_at(ctx: &Ctx) -> Result<Pulled> {
    let state = require_repo(ctx)?;
    if state.remote_url.is_none() {
        return Err(err(K::Failed, "Connect a repository first."));
    }
    if !state.changes.is_empty() || state.merging {
        return Err(err(K::Dirty, "Commit your changes first, so nothing is overwritten."));
    }
    let branch = state.branch.unwrap_or_else(|| "main".to_string());
    ctx.ok(&["fetch", "--quiet", "origin"], NETWORK)?;
    let incoming = ctx.run(&["rev-list", "--count", &format!("HEAD..origin/{branch}")], LOCAL)?;
    let pulled = incoming.stdout.trim().parse().unwrap_or(0);
    let output = ctx.run(&["pull", "--no-rebase", "--no-edit", "--allow-unrelated-histories", "origin", &branch], NETWORK)?;
    let after = status_at(ctx, false)?;
    let conflicts: Vec<String> = after.changes.iter().filter(|c| c.status == "conflicted").map(|c| c.path.clone()).collect();
    if !output.success && conflicts.is_empty() {
        return Err(if output.timed_out { err(K::Network, "Pull took too long and was stopped.") } else { classify_stderr(&output.stderr) });
    }
    Ok(Pulled { pulled, conflicts })
}

#[tauri::command]
pub async fn git_pull(state: State<'_, ProjectState>, lock: State<'_, GitLock>) -> Result<Pulled> {
    let (ctx, lock) = (Ctx::new(&state, true)?, lock.0.clone());
    blocking(move || locked(&lock, || pull_at(&ctx))).await
}

fn resolve_at(ctx: &Ctx, path: &str, take: &str) -> Result<GitState> {
    let rel = ctx.rel(path)?;
    match take {
        "mine" => ctx.ok(&["checkout", "--ours", "--", &rel], LOCAL)?,
        "theirs" => ctx.ok(&["checkout", "--theirs", "--", &rel], LOCAL)?,
        "edited" => String::new(),
        other => return Err(err(K::Failed, format!("unknown choice {other}"))),
    };
    ctx.ok(&["add", "--", &rel], LOCAL)?;
    status_at(ctx, false)
}

#[tauri::command]
pub async fn git_resolve(state: State<'_, ProjectState>, lock: State<'_, GitLock>, path: String, take: String) -> Result<GitState> {
    let (ctx, lock) = (Ctx::new(&state, true)?, lock.0.clone());
    blocking(move || locked(&lock, || resolve_at(&ctx, &path, &take))).await
}

#[tauri::command]
pub async fn git_abort_merge(state: State<'_, ProjectState>, lock: State<'_, GitLock>) -> Result<GitState> {
    let (ctx, lock) = (Ctx::new(&state, true)?, lock.0.clone());
    blocking(move || {
        locked(&lock, || {
            ctx.ok(&["merge", "--abort"], LOCAL)?;
            status_at(&ctx, false)
        })
    })
    .await
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn scratch(label: &str) -> Scratch {
        let dir = std::env::temp_dir().join(format!("lexy-git-test-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Scratch(fs::canonicalize(dir).unwrap())
    }

    /// A project folder with an isolated global config (identity set unless `identity` is false).
    fn ctx_in(dir: &Path, name: &str, identity: bool) -> Option<Ctx> {
        let Some(git) = find_git() else {
            println!("skipping: git not installed");
            return None;
        };
        let root = dir.join(name);
        fs::create_dir_all(&root).unwrap();
        let config = dir.join(format!("{name}.gitconfig"));
        let ident = if identity { "[user]\n\tname = Test\n\temail = test@example.com\n" } else { "" };
        fs::write(&config, format!("{ident}[init]\n\tdefaultBranch = main\n")).unwrap();
        let env = vec![
            ("GIT_CONFIG_GLOBAL".to_string(), display_path(&config)),
            ("GIT_CONFIG_NOSYSTEM".to_string(), "1".to_string()),
        ];
        Some(Ctx { git, root: fs::canonicalize(root).unwrap(), main: Some("main.tex".into()), env })
    }

    fn write(ctx: &Ctx, rel: &str, text: &str) {
        let path = ctx.root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    #[test]
    fn parses_porcelain_v2_with_rename_untracked_conflict_and_bangla() {
        let text = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 a b book/main.tex\0\
2 R. N... 100644 100644 100644 a b R100 book/new name.tex\0book/old.tex\0\
u UU N... 100644 100644 100644 100644 a b c book/ch.tex\0\
? book/অধ্যায়.tex\0? other/x.tex\0";
        let parsed = parse_status_v2(text, "book/");
        assert_eq!((parsed.branch.as_deref(), parsed.upstream, parsed.ahead, parsed.behind), (Some("main"), true, 2, 1));
        let got: Vec<_> = parsed.changes.iter().map(|c| (c.path.as_str(), c.old_path.as_deref(), c.status)).collect();
        assert_eq!(
            got,
            [
                ("main.tex", None, "modified"),
                ("new name.tex", Some("old.tex"), "renamed"),
                ("ch.tex", None, "conflicted"),
                ("অধ্যায়.tex", None, "added"),
            ]
        );
    }

    #[test]
    fn classifies_stderr_and_validates_input() {
        assert_eq!(classify_stderr(" ! [rejected] main -> main (fetch first)").kind, K::Rejected);
        assert_eq!(classify_stderr("fatal: unable to access 'https://x/': Could not resolve host: x").kind, K::Network);
        assert_eq!(classify_stderr("fatal: Authentication failed for 'https://x/'").kind, K::Auth);
        assert_eq!(classify_stderr("fatal: something odd").message, "fatal: something odd");
        assert!(valid_url("https://github.com/u/r.git") && valid_url("git@github.com:u/r.git") && valid_url("ssh://h/r"));
        assert!(!valid_url("-oProxyCommand=x") && !valid_url("https://a b") && !valid_url("C:\\repo") && !valid_url("file:///x"));
        assert!(valid_commit("0123abc").is_ok() && valid_commit("--all").is_err() && valid_commit("HEAD").is_err());
        assert!(valid_repo_name("my-thesis_2.0") && !valid_repo_name("a/b") && !valid_repo_name(""));
        assert_eq!(web_link("git@github.com:u/r.git"), "https://github.com/u/r");
        assert_eq!(web_link("https://github.com/u/r.git\n"), "https://github.com/u/r");
    }

    #[test]
    fn parses_log_and_name_status() {
        let log = "\u{1e}aaa\u{1f}Ann\u{1f}100\u{1f}Second\n\n 2 files changed, 3 insertions(+)\n\u{1e}bbb\u{1f}Ann\u{1f}50\u{1f}First\n";
        let got = parse_log(log);
        assert_eq!((got.len(), got[0].files, got[1].files, got[1].message.as_str()), (2, 2, 0, "First"));
        let changes = parse_name_status("M\0p/a.tex\0R090\0p/b.tex\0p/c.tex\0D\0q/x\0", "p/");
        assert_eq!(changes.len(), 2);
        assert_eq!((changes[1].path.as_str(), changes[1].old_path.as_deref()), ("c.tex", Some("b.tex")));
    }

    #[test]
    fn state_json_is_camel_case() {
        let json = serde_json::to_value(GitState { repo: "own", repo_root: Some("x".into()), ..Default::default() }).unwrap();
        assert!(json.get("repoRoot").is_some() && json.get("remoteUrl").is_some() && json.get("readOnly").is_some());
        let error = serde_json::to_value(err(K::NeedsIdentity, "x")).unwrap();
        assert_eq!(error["kind"], "needsIdentity");
    }

    #[test]
    fn local_history_end_to_end() {
        let dir = scratch("local");
        let Some(ctx) = ctx_in(&dir.0, "book", true) else { return };
        assert_eq!(status_at(&ctx, false).unwrap().repo, "none");
        write(&ctx, "main.tex", "\\documentclass{article}\r\nHello\r\n");
        write(&ctx, "main.aux", "junk");
        write(&ctx, "অধ্যায়.tex", "বাংলা");
        let state = init_at(&ctx).unwrap();
        assert_eq!((state.repo, state.changes.len(), state.branch.as_deref()), ("own", 0, Some("main")));
        let ignore = fs::read_to_string(ctx.root.join(".gitignore")).unwrap();
        assert!(ignore.contains("*.aux") && ignore.contains("/main.pdf"));
        assert_eq!(log_at(&ctx, 0, 50).unwrap()[0].message, FIRST_COMMIT);

        assert_eq!(commit_at(&ctx, "  ", false).unwrap_err().kind, K::EmptyMessage);
        assert_eq!(commit_at(&ctx, "x", false).unwrap_err().kind, K::NothingToCommit);

        // Line-ending-only change shows no diff lines.
        write(&ctx, "main.tex", "\\documentclass{article}\nHello\n");
        assert!(!diff_at(&ctx, "main.tex", None).unwrap().patch.contains("\n-Hello"));
        write(&ctx, "main.tex", "\\documentclass{article}\nHello world\n");
        fs::remove_file(ctx.root.join("অধ্যায়.tex")).unwrap();
        write(&ctx, "fig.png", "\0\u{1}\u{2}binary");
        let changes = status_at(&ctx, false).unwrap().changes;
        let mut got: Vec<_> = changes.iter().map(|c| (c.path.as_str(), c.status)).collect();
        got.sort();
        assert_eq!(got, [("fig.png", "added"), ("main.tex", "modified"), ("অধ্যায়.tex", "deleted")]);
        let diff = diff_at(&ctx, "main.tex", None).unwrap();
        assert!(diff.patch.contains("-Hello") && diff.patch.contains("+Hello world"), "{}", diff.patch);
        let binary = diff_at(&ctx, "fig.png", None).unwrap();
        assert!(binary.binary && binary.new_size == Some(9));

        let first = commit_at(&ctx, "Chapter 1", false).unwrap();
        assert!(status_at(&ctx, false).unwrap().changes.is_empty());
        assert_eq!(log_files_at(&ctx, &first.id).unwrap().len(), 3);

        write(&ctx, "main.tex", "v3\n");
        commit_at(&ctx, "Third", false).unwrap();
        let log = log_at(&ctx, 0, 50).unwrap();
        assert_eq!(log.iter().map(|c| c.message.as_str()).collect::<Vec<_>>(), ["Third", "Chapter 1", FIRST_COMMIT]);
        assert_eq!(log_at(&ctx, 1, 1).unwrap()[0].message, "Chapter 1");

        // Restore a file, then the whole project; later commits stay in history.
        let start = &log[2].id;
        assert!(show_file_at(&ctx, start, "main.tex").unwrap().contains("Hello"));
        restore_at(&ctx, start, Some("main.tex")).unwrap();
        assert!(fs::read_to_string(ctx.root.join("main.tex")).unwrap().contains("Hello"));
        restore_at(&ctx, start, None).unwrap();
        assert!(ctx.root.join("অধ্যায়.tex").exists() && !ctx.root.join("fig.png").exists());
        assert_eq!(log_at(&ctx, 0, 50).unwrap().len(), 3);
        assert!(!status_at(&ctx, false).unwrap().changes.is_empty());
        assert!(restore_at(&ctx, "--all", None).is_err());
        assert!(diff_at(&ctx, "../outside.tex", None).is_err());
    }

    #[test]
    fn identity_is_asked_once_and_large_files_warn() {
        let dir = scratch("identity");
        let Some(ctx) = ctx_in(&dir.0, "p", false) else { return };
        write(&ctx, "main.tex", "x");
        assert_eq!(init_at(&ctx).unwrap_err().kind, K::NeedsIdentity);
        assert_eq!(set_identity_at(&ctx, "Ann", "nope").unwrap_err().kind, K::NeedsIdentity);
        set_identity_at(&ctx, "Ann", "ann@example.com").unwrap();
        init_at(&ctx).unwrap();
        let big = fs::File::create(ctx.root.join("data.bin")).unwrap();
        big.set_len(LARGE_FILE + 1).unwrap();
        let error = commit_at(&ctx, "big", false).unwrap_err();
        assert_eq!((error.kind, error.message.as_str()), (K::LargeFiles, "data.bin"));
        add_ignore_lines(&ctx.root, &["/data.bin".into()]).unwrap();
        commit_at(&ctx, "ignore data", false).unwrap();
        assert!(status_at(&ctx, false).unwrap().changes.is_empty());
    }

    #[test]
    fn project_inside_a_parent_repo_sees_only_its_files() {
        let dir = scratch("parent");
        let Some(outer) = ctx_in(&dir.0, "docs", true) else { return };
        write(&outer, "notes.txt", "x");
        write(&outer, "book/main.tex", "x");
        init_at(&outer).unwrap();
        let ctx = Ctx { root: outer.root.join("book"), git: outer.git.clone(), main: None, env: outer.env.clone() };
        write(&outer, "notes.txt", "changed");
        write(&ctx, "main.tex", "changed");
        let state = status_at(&ctx, false).unwrap();
        assert_eq!(state.repo, "parent");
        assert_eq!(state.changes.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), ["main.tex"]);
        assert_eq!(init_at(&ctx).unwrap_err().kind, K::Failed);
        commit_at(&ctx, "book only", false).unwrap();
        let outer_left = status_at(&outer, false).unwrap().changes;
        assert_eq!(outer_left.iter().map(|c| c.path.as_str()).collect::<Vec<_>>(), ["notes.txt"]);
    }

    #[test]
    fn push_pull_and_conflicts_with_a_local_remote() {
        let dir = scratch("remote");
        let Some(mine) = ctx_in(&dir.0, "mine", true) else { return };
        let bare = dir.0.join("origin.git");
        mine.ok(&["init", "-q", "--bare", &display_path(&bare)], LOCAL).unwrap();
        write(&mine, "main.tex", "one\ntwo\nthree\n");
        init_at(&mine).unwrap();

        // connect_at only accepts network URLs; wire the local bare repo directly.
        assert_eq!(connect_at(&mine, "file:///x").unwrap_err().kind, K::BadUrl);
        mine.ok(&["remote", "add", "origin", &display_path(&bare)], LOCAL).unwrap();
        assert_eq!(push_at(&mine).unwrap(), 1);
        assert_eq!(status_at(&mine, true).unwrap().ahead, 0);

        let Some(theirs) = ctx_in(&dir.0, "theirs", true) else { return };
        fs::remove_dir(&theirs.root).unwrap();
        mine.ok(&["clone", "-q", &display_path(&bare), &display_path(&theirs.root)], NETWORK).unwrap();
        write(&theirs, "main.tex", "one\nTWO theirs\nthree\n");
        commit_at(&theirs, "Their edit", false).unwrap();
        theirs.ok(&["push", "-q"], NETWORK).unwrap();

        write(&mine, "other.tex", "x");
        assert_eq!(pull_at(&mine).unwrap_err().kind, K::Dirty);
        commit_at(&mine, "Other file", false).unwrap();
        assert_eq!(push_at(&mine).unwrap_err().kind, K::Rejected);
        assert_eq!(pull_at(&mine).unwrap(), Pulled { pulled: 1, conflicts: vec![] });
        assert!(fs::read_to_string(mine.root.join("main.tex")).unwrap().contains("TWO theirs"));
        push_at(&mine).unwrap();

        // Conflict: both edit line 2.
        theirs.ok(&["pull", "-q", "--no-rebase", "--no-edit"], NETWORK).unwrap();
        write(&theirs, "main.tex", "one\nTWO again\nthree\n");
        commit_at(&theirs, "Theirs 2", false).unwrap();
        theirs.ok(&["push", "-q"], NETWORK).unwrap();
        write(&mine, "main.tex", "one\nTWO mine\nthree\n");
        commit_at(&mine, "Mine 2", false).unwrap();

        let pulled = pull_at(&mine).unwrap();
        assert_eq!(pulled.conflicts, ["main.tex"]);
        assert!(status_at(&mine, false).unwrap().merging);
        mine.ok(&["merge", "--abort"], LOCAL).unwrap();
        assert!(fs::read_to_string(mine.root.join("main.tex")).unwrap().contains("TWO mine"));

        pull_at(&mine).unwrap();
        let state = resolve_at(&mine, "main.tex", "theirs").unwrap();
        assert!(state.merging && !state.changes.iter().any(|c| c.status == "conflicted"));
        commit_at(&mine, "Merge", false).unwrap();
        assert!(fs::read_to_string(mine.root.join("main.tex")).unwrap().contains("TWO again"));
        assert!(!status_at(&mine, false).unwrap().merging);
    }
}
