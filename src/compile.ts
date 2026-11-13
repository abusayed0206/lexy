import { invoke } from "@tauri-apps/api/core";

/** Mirrors `CompileResult` in src-tauri/src/lib.rs. */
export type CompileResult = {
  ok: boolean;
  summary: string;
  log: string;
  pdfPath: string | null;
  engine: "pdflatex" | "xelatex" | "lualatex";
};

/**
 * Compile the given text. The backend writes a snapshot into Lexy's build folder and
 * never touches `documentPath`; the path only names the build folder and lets files
 * beside the saved document be found.
 */
export function compileSource(source: string, documentPath: string | null): Promise<CompileResult> {
  return invoke<CompileResult>("compile_source", { source, documentPath });
}

/** Copy a build PDF next to the document as `<name>.pdf`; returns where it was written. */
export function exportPdf(pdfPath: string, documentPath: string): Promise<string> {
  return invoke<string>("export_pdf", { pdfPath, documentPath });
}

/** Raw PDF bytes from Lexy's build folder (the backend refuses any other path). */
export async function loadPdf(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_pdf", { path }));
}
