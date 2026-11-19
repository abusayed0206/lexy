import { invoke } from "@tauri-apps/api/core";
import type { CompileResult } from "./compile";

/** Mirrors `ProjectError` in src-tauri/src/project.rs. */
export type ProjectErrorKind =
  | "outsideProject"
  | "notFound"
  | "nameTaken"
  | "invalidName"
  | "noRecycleBin"
  | "readOnly"
  | "noProject"
  | "io";
export type ProjectError = { kind: ProjectErrorKind; message: string };

export type ProjectSummary = {
  path: string;
  name: string;
  modified: number;
  lastOpened: number | null;
  inDefaultFolder: boolean;
  missing: boolean;
};

export type OpenedProject = {
  root: string;
  name: string;
  readOnly: boolean;
  mainDocument: string | null;
  candidates: string[];
};

export type Entry = {
  path: string;
  name: string;
  kind: "file" | "folder";
  editable: boolean;
  hidden: boolean;
  modified: number;
};

export type ImportResult = { copied: string[]; skipped: string[]; conflicts: string[] };
export type OnConflict = "replace" | "keepBoth" | "skip" | "ask";
export type Buffer = { path: string; text: string };

export function isProjectError(error: unknown, kind?: ProjectErrorKind): error is ProjectError {
  const value = error as ProjectError | null;
  return typeof value === "object" && value !== null && typeof value.kind === "string" && (!kind || value.kind === kind);
}

/** Readable text for any error a command can reject with. */
export function errorText(error: unknown): string {
  if (isProjectError(error)) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export const listProjects = () => invoke<ProjectSummary[]>("list_projects");
export const lastOpenProject = () => invoke<string | null>("last_open_project");
export const createProject = (name: string, starter: string) => invoke<string>("create_project", { name, starter });
export const countEntries = (path: string, limit: number) => invoke<number>("count_entries", { path, limit });
export const forgetProject = (path: string) => invoke<void>("forget_project", { path });
export const openProject = (path: string) => invoke<OpenedProject>("open_project", { path });
export const closeProject = () => invoke<void>("close_project");
export const setMainDocument = (rel: string) => invoke<void>("set_main_document", { rel });

export const listDir = (rel: string) => invoke<Entry[]>("list_dir", { rel });
export const readFile = (rel: string) => invoke<string>("read_file", { rel });
export const writeFile = (rel: string, contents: string) => invoke<void>("write_file", { rel, contents });
export const createFile = (rel: string) => invoke<void>("create_file", { rel });
export const createFolder = (rel: string) => invoke<void>("create_folder", { rel });
export const renameEntry = (from: string, to: string) => invoke<void>("rename_entry", { from, to });
export const deleteEntry = (rel: string, permanent: boolean) => invoke<void>("delete_entry", { rel, permanent });
export const importFiles = (sources: string[], targetDir: string, onConflict: OnConflict) =>
  invoke<ImportResult>("import_files", { sources, targetDir, onConflict });
export const openEntryExternal = (rel: string) => invoke<void>("open_entry_external", { rel });

/** Copy a file or folder into `toDir` under a free "(copy)" name; resolves to the new path. */
export const copyEntry = (from: string, toDir: string) => invoke<string>("copy_entry", { from, toDir });

/** Mirrors `Snapshot` in snapshots.rs: a saved earlier version of a file (projects without Git). */
export type Snapshot = { time: number; size: number };
export const listSnapshots = (file: string) => invoke<Snapshot[]>("list_snapshots", { file });
export const readSnapshot = (file: string, time: number) => invoke<string>("read_snapshot", { file, time });

/** Mirrors `recovery::RecoveryEntry` (spec 008): unsaved text kept outside the project. `path` uses `/`. */
export type RecoveryCopy = { path: string; text: string; savedAt: number; baseHash: string; diskChanged: boolean; missing: boolean };
export const recoverySave = (path: string, text: string) => invoke<void>("recovery_save", { path, text });
export const recoveryList = () => invoke<RecoveryCopy[]>("recovery_list");
/** `null` discards every copy of the open project. */
export const recoveryDiscard = (paths: string[] | null) => invoke<void>("recovery_discard", { paths });

/** Mirrors `ProjectText` / `ProjectTexts` in project.rs (spec 007 R1). */
export type ProjectText = { path: string; text: string; modified: number };
export type ProjectTexts = { files: ProjectText[]; truncated: boolean };
/** Every project text file, or only `paths` (missing ones are omitted). */
export const projectTexts = (paths?: string[]) => invoke<ProjectTexts>("project_texts", { paths: paths ?? null });

/** Compile the main document with the unsaved text of open files (never written to disk). */
export const compileProject = (main: string, buffers: Buffer[]) => invoke<CompileResult>("compile_project", { main, buffers });

// ----- path helpers (project-relative, `\` separated) -----

export function joinRel(dir: string, name: string): string {
  return dir ? `${dir}\\${name}` : name;
}

export function parentOf(rel: string): string {
  const index = rel.lastIndexOf("\\");
  return index < 0 ? "" : rel.slice(0, index);
}

export function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf("\\") + 1);
}

export function sameRel(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();
}

/** Is `rel` the folder `dir` itself or inside it? */
export function isWithin(rel: string, dir: string): boolean {
  const a = rel.toLowerCase();
  const b = dir.toLowerCase();
  return a === b || a.startsWith(`${b}\\`);
}

export function absolutePath(root: string, rel: string): string {
  return `${root.replace(/[\\/]+$/, "")}\\${rel}`;
}

/** Windows file-name rule shown to users (matches `valid_name` in project.rs). */
export function validName(name: string): boolean {
  const stem = name.split(".")[0].toLowerCase();
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !/[<>:"/\\|?*\u0000-\u001f]/.test(name) &&
    !/[. ]$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem)
  );
}

export const INVALID_NAME_MESSAGE = 'Use a name without \\ / : * ? " < > |';
