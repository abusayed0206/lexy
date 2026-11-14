import { invoke } from "@tauri-apps/api/core";

/** Mirrors `GitError` in src-tauri/src/git.rs. */
export type GitErrorKind =
  | "notInstalled"
  | "ghNotInstalled"
  | "noRepo"
  | "needsIdentity"
  | "emptyMessage"
  | "nothingToCommit"
  | "largeFiles"
  | "dirty"
  | "rejected"
  | "conflict"
  | "network"
  | "auth"
  | "badUrl"
  | "readOnly"
  | "busy"
  | "failed";
export type GitError = { kind: GitErrorKind; message: string };

export type ChangeStatus = "modified" | "added" | "deleted" | "renamed" | "conflicted";
export type Change = { path: string; oldPath: string | null; status: ChangeStatus; size: number | null };

export type GitState = {
  installed: boolean;
  repo: "none" | "own" | "parent" | "";
  repoRoot: string | null;
  branch: string | null;
  remoteUrl: string | null;
  ahead: number;
  behind: number;
  changes: Change[];
  merging: boolean;
  readOnly: boolean;
};

export type CommitInfo = { id: string; message: string; author: string; time: number; files: number };
export type FileDiff = { binary: boolean; oldSize: number | null; newSize: number | null; patch: string };

export function isGitError(error: unknown, kind?: GitErrorKind): error is GitError {
  const value = error as GitError | null;
  return typeof value === "object" && value !== null && typeof value.kind === "string" && (!kind || value.kind === kind);
}

export const STATUS_LETTER: Record<ChangeStatus, string> = { modified: "M", added: "A", deleted: "D", renamed: "R", conflicted: "C" };

/** `git@github.com:u/r.git` or `https://github.com/u/r.git` → a browsable https link. */
export function webLink(url: string): string {
  const trimmed = url.trim().replace(/\.git$/, "");
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(trimmed);
  return scp ? `https://${scp[1]}/${scp[2]}` : trimmed;
}

export const gitStatus = (fetch = false) => invoke<GitState>("git_status", { fetch });
export const gitInit = () => invoke<GitState>("git_init");
export const gitSetIdentity = (name: string, email: string) => invoke<void>("git_set_identity", { name, email });
export const gitCommit = (message: string, allowLarge = false) => invoke<{ id: string; message: string }>("git_commit", { message, allowLarge });
export const gitIgnore = (paths: string[]) => invoke<void>("git_ignore", { paths });
export const gitDiff = (path: string, commit?: string) => invoke<FileDiff>("git_diff", { path, commit: commit ?? null });
export const gitLog = (skip: number, limit = 50) => invoke<CommitInfo[]>("git_log", { skip, limit });
export const gitLogFiles = (commit: string) => invoke<Change[]>("git_log_files", { commit });
export const gitShowFile = (commit: string, path: string) => invoke<string>("git_show_file", { commit, path });
export const gitRestore = (commit: string, path?: string) => invoke<void>("git_restore", { commit, path: path ?? null });
export const gitConnectRemote = (url: string) => invoke<GitState>("git_connect_remote", { url });
export const gitPublishGithub = (name: string, isPrivate: boolean) => invoke<{ url: string }>("git_publish_github", { name, private: isPrivate });
export const gitPush = () => invoke<{ pushed: number }>("git_push");
export const gitPull = () => invoke<{ pulled: number; conflicts: string[] }>("git_pull");
export const gitResolve = (path: string, take: "mine" | "theirs" | "edited") => invoke<GitState>("git_resolve", { path, take });
export const gitAbortMerge = () => invoke<GitState>("git_abort_merge");
