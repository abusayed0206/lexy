import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileSource, exportPdf, loadPdf } from "./compile";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

describe("compileSource", () => {
  beforeEach(() => invokeMock.mockReset());

  it("sends the text and the document path and returns the result", async () => {
    const result = { ok: true, summary: "PDF ready", log: "", pdfPath: "C:\\b\\main.pdf", engine: "pdflatex" };
    invokeMock.mockResolvedValueOnce(result);
    await expect(compileSource("\\documentclass{article}", "C:\\docs\\main.tex")).resolves.toEqual(result);
    expect(invokeMock).toHaveBeenCalledWith("compile_source", {
      source: "\\documentclass{article}",
      documentPath: "C:\\docs\\main.tex",
    });
  });

  it("compiles untitled documents with a null path", async () => {
    invokeMock.mockResolvedValueOnce({});
    await compileSource("x", null);
    expect(invokeMock).toHaveBeenCalledWith("compile_source", { source: "x", documentPath: null });
  });

  it("propagates backend errors", async () => {
    invokeMock.mockRejectedValueOnce("the document is larger than 10 MiB");
    await expect(compileSource("x", null)).rejects.toContain("10 MiB");
  });
});

describe("loadPdf", () => {
  beforeEach(() => invokeMock.mockReset());

  it("returns the raw bytes for pdf.js", async () => {
    invokeMock.mockResolvedValueOnce(new TextEncoder().encode("%PDF-1.5").buffer);
    const bytes = await loadPdf("C:\\b\\main.pdf");
    expect(invokeMock).toHaveBeenCalledWith("read_pdf", { path: "C:\\b\\main.pdf" });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe("%PDF-1.5");
  });
});

describe("exportPdf", () => {
  beforeEach(() => invokeMock.mockReset());

  it("asks the backend to copy the build PDF next to the document", async () => {
    invokeMock.mockResolvedValueOnce("C:\\docs\\Thesis\\Thesis.pdf");
    await expect(exportPdf("C:\\b\\Thesis.pdf", "C:\\docs\\Thesis\\Thesis.tex")).resolves.toBe("C:\\docs\\Thesis\\Thesis.pdf");
    expect(invokeMock).toHaveBeenCalledWith("export_pdf", { pdfPath: "C:\\b\\Thesis.pdf", documentPath: "C:\\docs\\Thesis\\Thesis.tex" });
  });
});
