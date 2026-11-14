import { invoke } from "@tauri-apps/api/core";

/** Mirrors `CompileResult` in src-tauri/src/lib.rs. Compiles go through `compileProject` in projects.ts. */
export type CompileResult = {
  ok: boolean;
  summary: string;
  log: string;
  pdfPath: string | null;
  engine: "pdflatex" | "xelatex" | "lualatex";
  /** Errors and warnings with project-relative files (spec 003). */
  problems?: Problem[];
  /** Set when Lexy compiled a copy with this font because Bangla text had no font setup. */
  autoFont?: string | null;
};

/** Copy BCC Purno into the `fonts` folder next to the main document; returns the files written. */
export const installBanglaFont = (main: string) => invoke<string[]>("install_bangla_font", { main });

/** Mirrors `sync::Problem`. `file` is project-relative with `/`, null when outside the project. */
export type Problem = { severity: "error" | "warning"; file: string | null; line: number | null; message: string };
export type SyncTarget = { kind: "project"; file: string; line: number } | { kind: "external"; name: string } | null;
export type PdfSpot = { page: number; x: number; y: number; width: number; height: number } | null;

/** PDF point (page, x, y in points from the top-left) → source line, from the PDF on screen. */
export const syncToSource = (main: string, page: number, x: number, y: number) =>
  invoke<SyncTarget>("sync_to_source", { main, page, x, y });

/** Source line → spot in the PDF on screen. */
export const syncToPdf = (main: string, file: string, line: number) => invoke<PdfSpot>("sync_to_pdf", { main, file, line });

/** Copy a build PDF next to the document as `<name>.pdf`; returns where it was written. */
export function exportPdf(pdfPath: string, documentPath: string): Promise<string> {
  return invoke<string>("export_pdf", { pdfPath, documentPath });
}

/** Review → Export PDF with notes: compiles copies that carry 	odo notes and saves `<stem> (notes).pdf`; returns that name. */
export const exportPdfWithNotes = (main: string, buffers: { path: string; text: string }[]) =>
  invoke<string>("export_pdf_with_notes", { main, buffers });

/** Raw PDF bytes from Lexy's build folder (the backend refuses any other path). */
export async function loadPdf(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_pdf", { path }));
}

// ----- Word / HTML export (spec 007 US7) -----

/** Mirrors `ConverterStatus` / `ExportReport` in src-tauri/src/export.rs. */
export type ConverterStatus = { installed: boolean; version: string | null; downloadBytes: number };
export type ExportReport = { output: string; warnings: string[] };
export type ConverterProgress = { state: "downloading" | "unpacking" | "done" | "error"; bytesDone: number; bytesTotal: number; detail: string };

export const converterStatus = () => invoke<ConverterStatus>("converter_status");
/** Downloads the pinned Pandoc (hash-checked); progress comes as `converter-progress` events. Only after consent. */
export const installConverter = () => invoke<void>("install_converter");
/** Converts the saved main document; the file is written beside it. */
export const exportDocument = (main: string, format: "docx" | "html") => invoke<ExportReport>("export_document", { main, format });
