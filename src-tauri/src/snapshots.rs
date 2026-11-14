//! Local snapshots for projects without Git (spec 007 US5, research R16). Before a save
//! overwrites a file, its previous text is kept under
//! %LOCALAPPDATA%\Lexy\Snapshots\<hash(root)>\<rel>\<unix-ms>.txt — never inside the project —
//! at most one per file per 10 minutes, pruned after 30 days.

use serde::Serialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
};

pub const MIN_GAP_MS: u64 = 10 * 60 * 1000;
pub const MAX_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub time: u64,
    pub size: u64,
}

/// The snapshot folder for one project.
pub fn project_dir(base: &Path, root: &Path) -> PathBuf {
    base.join("Snapshots").join(crate::build_key(root))
}

/// True when `root` or a folder above it holds a Git repository (then Git is the history).
pub fn has_git(root: &Path) -> bool {
    root.ancestors().any(|dir| dir.join(".git").exists())
}

fn file_dir(dir: &Path, rel: &str) -> PathBuf {
    rel.split(['/', '\\']).filter(|part| !part.is_empty()).fold(dir.to_path_buf(), |path, part| path.join(part))
}

/// Snapshots of `rel`, newest first.
pub fn list(dir: &Path, rel: &str) -> Vec<Snapshot> {
    let Ok(entries) = fs::read_dir(file_dir(dir, rel)) else { return Vec::new() };
    let mut snapshots: Vec<Snapshot> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let time = name.to_str()?.strip_suffix(".txt")?.parse().ok()?;
            Some(Snapshot { time, size: entry.metadata().ok()?.len() })
        })
        .collect();
    snapshots.sort_by(|a, b| b.time.cmp(&a.time));
    snapshots
}

pub fn read(dir: &Path, rel: &str, time: u64) -> io::Result<String> {
    fs::read_to_string(file_dir(dir, rel).join(format!("{time}.txt")))
}

/// Keep `previous` as a snapshot of `rel` unless the newest one is younger than 10 minutes.
/// Returns whether a snapshot was written.
pub fn take(dir: &Path, rel: &str, previous: &str, now: u64) -> io::Result<bool> {
    if list(dir, rel).first().is_some_and(|newest| now.saturating_sub(newest.time) < MIN_GAP_MS) {
        return Ok(false);
    }
    let folder = file_dir(dir, rel);
    fs::create_dir_all(&folder)?;
    fs::write(folder.join(format!("{now}.txt")), previous)?;
    Ok(true)
}

/// Delete snapshots older than 30 days (and folders left empty).
pub fn prune(dir: &Path, now: u64) {
    fn walk(folder: &Path, now: u64) -> bool {
        let Ok(entries) = fs::read_dir(folder) else { return false };
        let mut empty = true;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if walk(&path, now) {
                    let _ = fs::remove_dir(&path);
                } else {
                    empty = false;
                }
                continue;
            }
            let time = path.file_stem().and_then(|stem| stem.to_str()).and_then(|stem| stem.parse::<u64>().ok());
            if time.is_some_and(|time| now.saturating_sub(time) > MAX_AGE_MS) {
                let _ = fs::remove_file(&path);
            } else {
                empty = false;
            }
        }
        empty
    }
    walk(dir, now);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lexy-snapshots-test-{}-{label}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn takes_at_most_one_snapshot_per_ten_minutes() {
        let dir = temp("gap");
        assert!(take(&dir, "chapters\\intro.tex", "v1", 1_000).unwrap());
        assert!(!take(&dir, "chapters\\intro.tex", "v2", 1_000 + MIN_GAP_MS - 1).unwrap());
        assert!(take(&dir, "chapters/intro.tex", "v3", 1_000 + MIN_GAP_MS).unwrap());
        assert_eq!(list(&dir, "chapters\\intro.tex"), [Snapshot { time: 1_000 + MIN_GAP_MS, size: 2 }, Snapshot { time: 1_000, size: 2 }]);
        assert_eq!(read(&dir, "chapters\\intro.tex", 1_000).unwrap(), "v1");
        assert!(list(&dir, "other.tex").is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn prune_drops_snapshots_older_than_thirty_days() {
        let dir = temp("prune");
        take(&dir, "a.tex", "old", 1).unwrap();
        take(&dir, "b\\c.tex", "old", 1).unwrap();
        take(&dir, "a.tex", "new", MAX_AGE_MS).unwrap();
        prune(&dir, MAX_AGE_MS + 2);
        assert_eq!(list(&dir, "a.tex").iter().map(|s| s.time).collect::<Vec<_>>(), [MAX_AGE_MS]);
        assert!(!dir.join("b").exists(), "empty folders are removed");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn detects_git_in_the_project_or_above() {
        let dir = temp("git");
        let project = dir.join("repo").join("paper");
        fs::create_dir_all(&project).unwrap();
        assert!(!has_git(&project));
        fs::create_dir_all(dir.join("repo").join(".git")).unwrap();
        assert!(has_git(&project));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn snapshots_live_outside_the_project() {
        let base = temp("base");
        let root = Path::new(r"C:\Docs\Paper");
        let dir = project_dir(&base, root);
        assert!(dir.starts_with(base.join("Snapshots")));
        assert_eq!(dir, project_dir(&base, Path::new(r"c:\docs\paper")));
    }
}
