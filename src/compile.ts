import { invoke } from "@tauri-apps/api/core";

/** Mirrors `CompileResult` in src-tauri/src/lib.rs. Compiles go through `compileProject` in projects.ts. */
export type CompileResult = {
  ok: boolean;
  summary: string;
  log: string;
  pdfPath: string | null;
  engine: "pdflatex" | "xelatex" | "lualatex";
};

/** Copy a build PDF next to the document as `<name>.pdf`; returns where it was written. */
export function exportPdf(pdfPath: string, documentPath: string): Promise<string> {
  return invoke<string>("export_pdf", { pdfPath, documentPath });
}

/** Raw PDF bytes from Lexy's build folder (the backend refuses any other path). */
export async function loadPdf(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_pdf", { path }));
}
