import { invoke } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";

const filters = [{ name: "LaTeX document", extensions: ["tex"] }];

export type DefaultFolder = { path: string; fallback: boolean };

export function readDocument(path: string): Promise<string> {
  return invoke<string>("read_document", { path });
}

export function writeDocument(path: string, contents: string): Promise<void> {
  return invoke<void>("write_document", { path, contents });
}

let folder: Promise<DefaultFolder> | null = null;

/** `<Documents>\Lexy` (created by the backend on first use), or the home folder as a fallback. */
export function defaultFolder(): Promise<DefaultFolder> {
  folder ??= invoke<DefaultFolder>("default_document_folder").catch((error) => {
    folder = null;
    throw error;
  });
  return folder;
}

export function joinPath(dir: string, name: string): string {
  const separator = dir.includes("\\") || !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(separator) ? `${dir}${name}` : `${dir}${separator}${name}`;
}

export async function chooseOpenPath(startIn: string | null): Promise<string | null> {
  const picked = await open({ multiple: false, directory: false, filters, ...(startIn ? { defaultPath: startIn } : {}) });
  return typeof picked === "string" ? picked : null;
}

/** Untitled documents start in `startIn` with `suggestedName`; saved ones at their current path. */
export async function chooseSavePath(
  currentPath: string | null,
  startIn: string | null,
  suggestedName = "Untitled.tex",
): Promise<string | null> {
  const defaultPath = currentPath ?? (startIn ? joinPath(startIn, suggestedName) : suggestedName);
  const picked = await save({ defaultPath, filters });
  return picked ? withTexExtension(picked) : null;
}

/** Where the file really goes: saving straight into Documents\Lexy creates `Lexy\Name\Name.tex`. */
export function prepareSavePath(path: string): Promise<string> {
  return invoke<string>("prepare_save_path", { path });
}

/** File name from the document's \title{…}: LaTeX stripped, Windows-safe, else "Untitled.tex". */
export function suggestFileName(source: string): string {
  const title = /\\title\s*\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(source)?.[1] ?? "";
  const plain = title
    .replace(/\\[a-zA-Z]+\*?/g, " ") // commands like \textbf, \\ and \LaTeX
    .replace(/\\./g, "")
    .replace(/[{}~$^_&%#]/g, " ")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ") // characters Windows forbids in file names
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 60)
    .trim();
  return `${plain || "Untitled"}.tex`;
}

export function confirmDiscard(): Promise<boolean> {
  return ask("You have unsaved changes. Discard them?", {
    title: "Lexy",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Cancel",
  });
}

export function withTexExtension(path: string): string {
  return /\.tex$/i.test(path) ? path : `${path}.tex`;
}

export function fileName(path: string | null): string {
  return path ? path.split(/[\\/]/).pop() || path : "Untitled.tex";
}
