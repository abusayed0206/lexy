import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportPdf, loadPdf } from "./compile";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

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
