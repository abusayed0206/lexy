//! Crash recovery (spec 008 US1, research R3): the unsaved text of open files is kept under
//! %LOCALAPPDATA%\Lexy\Recovery\<hash(root)>\<hash(rel)>.json — never inside the project — so it
//! can be offered again after a crash. Copies are deleted on save, discard and clean close, and
//! pruned after 30 days.

use crate::project::{self, resolve_in_project, ErrorKind, ProjectError, ProjectState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

type Result<T> = std::result::Result<T, ProjectError>;

const MAX_TEXT_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    path: String,
    text: String,
    saved_at: u64,
    /// SHA-256 of the file on disk when the copy was made; empty when it did not exist.
    base_hash: String,
}

/// One recovery copy as offered to the UI (data-model.md RecoveryCopy).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    pub path: String,
    pub text: String,
    pub saved_at: u64,
    pub base_hash: String,
    pub disk_changed: bool,
    pub missing: bool,
}

/// The recovery folder of one project.
pub fn project_dir(base: &Path, root: &Path) -> PathBuf {
    base.join("Recovery").join(crate::build_key(root))
}

fn normalize(rel: &str) -> String {
    rel.replace('\\', "/")
}

fn copy_file(dir: &Path, rel: &str) -> PathBuf {
    dir.join(format!("{}.json", crate::build_key(Path::new(&normalize(rel)))))
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Keep `text` as the unsaved text of `rel`; atomic, so a crash mid-write keeps the old copy.
pub fn save(dir: &Path, root: &Path, rel: &str, text: &str, now: u64) -> Result<()> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(ProjectError::new(ErrorKind::Io, format!("{rel} is larger than 10 MiB")));
    }
    let path = resolve_in_project(root, rel)?;
    let base_hash = fs::read(&path).map(|bytes| hash(&bytes)).unwrap_or_default();
    fs::create_dir_all(dir).map_err(|error| ProjectError::new(ErrorKind::Io, format!("failed to create the recovery folder: {error}")))?;
    let stored = Stored { path: normalize(rel), text: text.to_string(), saved_at: now, base_hash };
    let json = serde_json::to_vec(&stored).map_err(|error| ProjectError::new(ErrorKind::Io, error.to_string()))?;
    crate::write_atomic(&copy_file(dir, rel), &json)?;
    Ok(())
}

fn read_stored(file: &Path) -> Option<Stored> {
    serde_json::from_slice(&fs::read(file).ok()?).ok()
}

fn copies(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect()
}

/// Copies whose text differs from the file on disk, sorted by path; the others are deleted.
pub fn list(dir: &Path, root: &Path) -> Vec<RecoveryEntry> {
    let mut entries = Vec::new();
    for file in copies(dir) {
        let Some(stored) = read_stored(&file) else {
            let _ = fs::remove_file(&file);
            continue;
        };
        let Ok(path) = resolve_in_project(root, &stored.path) else {
            let _ = fs::remove_file(&file);
            continue;
        };
        let (disk_changed, missing) = match fs::read(&path) {
            Ok(bytes) if bytes == stored.text.as_bytes() => {
                let _ = fs::remove_file(&file);
                continue;
            }
            Ok(bytes) => (hash(&bytes) != stored.base_hash, false),
            Err(_) => (!stored.base_hash.is_empty(), true),
        };
        entries.push(RecoveryEntry {
            path: stored.path,
            text: stored.text,
            saved_at: stored.saved_at,
            base_hash: stored.base_hash,
            disk_changed,
            missing,
        });
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    entries
}

/// Delete the copies of `paths`, or all of the project's copies.
pub fn discard(dir: &Path, paths: Option<&[String]>) {
    match paths {
        None => {
            let _ = fs::remove_dir_all(dir);
        }
        Some(paths) => {
            for rel in paths {
                let _ = fs::remove_file(copy_file(dir, rel));
            }
        }
    }
}

/// Delete copies older than 30 days in every project, and folders left empty.
pub fn prune(base: &Path, now: u64) {
    let Ok(projects) = fs::read_dir(base.join("Recovery")) else { return };
    for project in projects.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()) {
        for file in copies(&project) {
            let old = read_stored(&file).is_none_or(|stored| now.saturating_sub(stored.saved_at) > crate::snapshots::MAX_AGE_MS);
            if old {
                let _ = fs::remove_file(&file);
            }
        }
        // Only succeeds when empty.
        let _ = fs::remove_dir(&project);
    }
}

/// The open project's root and recovery folder; `None` in a read-only window.
fn open_dir(state: &ProjectState) -> Result<Option<(PathBuf, PathBuf)>> {
    let (root, read_only) = state.with(|open| Ok((open.root.clone(), open.read_only)))?;
    if read_only {
        return Ok(None);
    }
    let dir = project_dir(&project::app_data_dir()?, &root);
    Ok(Some((root, dir)))
}

fn read_only_error() -> ProjectError {
    ProjectError::new(ErrorKind::ReadOnly, "this project is open in another Lexy window")
}

#[tauri::command]
pub async fn recovery_save(state: State<'_, ProjectState>, path: String, text: String) -> Result<()> {
    let (root, dir) = open_dir(&state)?.ok_or_else(read_only_error)?;
    tauri::async_runtime::spawn_blocking(move || save(&dir, &root, &path, &text, project::now_ms()))
        .await
        .map_err(|error| ProjectError::new(ErrorKind::Io, format!("recovery task failed: {error}")))?
}

#[tauri::command]
pub async fn recovery_list(state: State<'_, ProjectState>) -> Result<Vec<RecoveryEntry>> {
    let Some((root, dir)) = open_dir(&state)? else { return Ok(Vec::new()) };
    let base = project::app_data_dir()?;
    tauri::async_runtime::spawn_blocking(move || {
        prune(&base, project::now_ms());
        list(&dir, &root)
    })
    .await
    .map_err(|error| ProjectError::new(ErrorKind::Io, format!("recovery task failed: {error}")))
}

#[tauri::command]
pub fn recovery_discard(state: State<'_, ProjectState>, paths: Option<Vec<String>>) -> Result<()> {
    let (_, dir) = open_dir(&state)?.ok_or_else(read_only_error)?;
    discard(&dir, paths.as_deref());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(label: &str) -> Self {
            let dir = env::temp_dir().join(format!("lexy-recovery-test-{}-{label}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("create temp dir");
            Self(fs::canonicalize(&dir).expect("canonical temp dir"))
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// A project with `main.tex` and `chapters/intro.tex`, plus a separate data folder.
    fn setup(label: &str) -> (TempDir, PathBuf, PathBuf) {
        let temp = TempDir::new(label);
        let root = temp.0.join("Project");
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(root.join("main.tex"), "disk main").unwrap();
        fs::write(root.join("chapters").join("intro.tex"), "disk intro").unwrap();
        let dir = project_dir(&temp.0.join("Data"), &root);
        (temp, root, dir)
    }

    fn names(root: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(root).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn save_and_list_round_trip_exact_text() {
        let (_temp, root, dir) = setup("round-trip");
        let text = "আমার লেখা\r\nline two\r\n";
        save(&dir, &root, "chapters\\intro.tex", text, 5).unwrap();
        let listed = list(&dir, &root);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, "chapters/intro.tex");
        assert_eq!(listed[0].text, text);
        assert_eq!(listed[0].saved_at, 5);
        assert!(!listed[0].disk_changed && !listed[0].missing);
        // The same file under another spelling replaces the copy instead of adding one.
        save(&dir, &root, "Chapters/Intro.tex", "newer", 6).unwrap();
        assert_eq!(list(&dir, &root).len(), 1);
    }

    #[test]
    fn copies_equal_to_disk_are_not_offered_and_are_deleted() {
        let (_temp, root, dir) = setup("equal");
        save(&dir, &root, "main.tex", "disk main", 1).unwrap();
        assert!(list(&dir, &root).is_empty());
        assert!(copies(&dir).is_empty());
    }

    #[test]
    fn disk_changes_and_deleted_files_are_flagged() {
        let (_temp, root, dir) = setup("flags");
        save(&dir, &root, "main.tex", "unsaved main", 1).unwrap();
        save(&dir, &root, "chapters/intro.tex", "unsaved intro", 1).unwrap();
        save(&dir, &root, "new.tex", "never saved", 1).unwrap();
        fs::write(root.join("main.tex"), "changed by git").unwrap();
        fs::remove_file(root.join("chapters").join("intro.tex")).unwrap();
        let listed = list(&dir, &root);
        let flags: Vec<(&str, bool, bool)> = listed.iter().map(|e| (e.path.as_str(), e.disk_changed, e.missing)).collect();
        assert_eq!(flags, [("chapters/intro.tex", true, true), ("main.tex", true, false), ("new.tex", false, true)]);
    }

    #[test]
    fn a_failed_write_keeps_the_previous_copy() {
        let (_temp, root, dir) = setup("failed-write");
        save(&dir, &root, "main.tex", "first", 1).unwrap();
        // A folder where the temp file would go makes the atomic write fail.
        let target = copy_file(&dir, "main.tex");
        let temp = target.with_file_name(format!(".{}.lexy-tmp", target.file_name().unwrap().to_string_lossy()));
        fs::create_dir_all(&temp).unwrap();
        assert!(save(&dir, &root, "main.tex", "second", 2).is_err());
        assert_eq!(list(&dir, &root)[0].text, "first");
    }

    #[test]
    fn discard_one_or_all() {
        let (_temp, root, dir) = setup("discard");
        save(&dir, &root, "main.tex", "a", 1).unwrap();
        save(&dir, &root, "chapters/intro.tex", "b", 1).unwrap();
        discard(&dir, Some(&["chapters\\intro.tex".to_string()]));
        assert_eq!(list(&dir, &root).iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), ["main.tex"]);
        discard(&dir, None);
        assert!(!dir.exists());
    }

    #[test]
    fn prune_drops_old_copies_and_empty_folders() {
        let (temp, root, dir) = setup("prune");
        let day = 24 * 60 * 60 * 1000;
        let now = 100 * day;
        save(&dir, &root, "main.tex", "old", now - 31 * day).unwrap();
        save(&dir, &root, "chapters/intro.tex", "fresh", now - day).unwrap();
        prune(&temp.0.join("Data"), now);
        assert_eq!(list(&dir, &root).iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), ["chapters/intro.tex"]);
        prune(&temp.0.join("Data"), now + 40 * day);
        assert!(!dir.exists());
    }

    #[test]
    fn paths_outside_the_project_are_refused_and_nothing_is_written_into_it() {
        let (_temp, root, dir) = setup("outside");
        assert!(save(&dir, &root, "..\\evil.tex", "x", 1).is_err());
        assert!(save(&dir, &root, "C:\\Windows\\x.tex", "x", 1).is_err());
        assert!(save(&dir, &root, "main.tex", &"y".repeat(MAX_TEXT_BYTES + 1), 1).is_err());
        save(&dir, &root, "main.tex", "unsaved", 1).unwrap();
        assert_eq!(names(&root), ["chapters", "main.tex"]);
        assert_eq!(fs::read_to_string(root.join("main.tex")).unwrap(), "disk main");
    }
}
