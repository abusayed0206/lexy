import { invoke } from "@tauri-apps/api/core";

export type DefaultFolder = { path: string; fallback: boolean };

let folder: Promise<DefaultFolder> | null = null;

/** `<Documents>\Lexy` (created by the backend on first use), or the home folder as a fallback. */
export function defaultFolder(): Promise<DefaultFolder> {
  folder ??= invoke<DefaultFolder>("default_document_folder").catch((error) => {
    folder = null;
    throw error;
  });
  return folder;
}
