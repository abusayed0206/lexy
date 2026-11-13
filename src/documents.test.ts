import { invoke } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  chooseOpenPath,
  chooseSavePath,
  confirmDiscard,
  fileName,
  joinPath,
  prepareSavePath,
  readDocument,
  suggestFileName,
  withTexExtension,
  writeDocument,
} from "./documents";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(), open: vi.fn(), save: vi.fn() }));

const texFilter = [{ name: "LaTeX document", extensions: ["tex"] }];
const LEXY = "C:\\Users\\me\\Documents\\Lexy";

describe("documents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads and writes through the backend commands", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("\\documentclass{article}").mockResolvedValueOnce(undefined);
    await expect(readDocument("C:\\a.tex")).resolves.toBe("\\documentclass{article}");
    await writeDocument("C:\\a.tex", "text");
    expect(invoke).toHaveBeenNthCalledWith(1, "read_document", { path: "C:\\a.tex" });
    expect(invoke).toHaveBeenNthCalledWith(2, "write_document", { path: "C:\\a.tex", contents: "text" });
  });

  it("opens a single .tex file, starting in the default folder", async () => {
    vi.mocked(open).mockResolvedValueOnce("C:\\docs\\paper.tex");
    await expect(chooseOpenPath(LEXY)).resolves.toBe("C:\\docs\\paper.tex");
    expect(open).toHaveBeenCalledWith({ multiple: false, directory: false, filters: texFilter, defaultPath: LEXY });
  });

  it("opens without a start folder when none is known, and handles cancel", async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    await expect(chooseOpenPath(null)).resolves.toBeNull();
    expect(open).toHaveBeenCalledWith({ multiple: false, directory: false, filters: texFilter });
  });

  it("suggests <folder>\\Untitled.tex for a new document and the current path otherwise", async () => {
    vi.mocked(save).mockResolvedValue("C:\\x.tex");
    await chooseSavePath(null, LEXY);
    expect(save).toHaveBeenLastCalledWith({ defaultPath: `${LEXY}\\Untitled.tex`, filters: texFilter });
    await chooseSavePath("C:\\docs\\paper.tex", "C:\\ignored");
    expect(save).toHaveBeenLastCalledWith({ defaultPath: "C:\\docs\\paper.tex", filters: texFilter });
    await chooseSavePath(null, null);
    expect(save).toHaveBeenLastCalledWith({ defaultPath: "Untitled.tex", filters: texFilter });
  });

  it("adds .tex when the user types a name without it, and handles cancel", async () => {
    vi.mocked(save).mockResolvedValueOnce("C:\\docs\\notes").mockResolvedValueOnce(null);
    await expect(chooseSavePath(null, null)).resolves.toBe("C:\\docs\\notes.tex");
    await expect(chooseSavePath(null, null)).resolves.toBeNull();
  });

  it.each([
    ["C:\\Docs\\Lexy", "C:\\Docs\\Lexy\\Untitled.tex"],
    ["C:\\Docs\\Lexy\\", "C:\\Docs\\Lexy\\Untitled.tex"],
    ["/home/me/Lexy", "/home/me/Lexy/Untitled.tex"],
  ])("joinPath(%s)", (dir, expected) => {
    expect(joinPath(dir, "Untitled.tex")).toBe(expected);
  });

  it("passes a suggested name for untitled documents", async () => {
    vi.mocked(save).mockResolvedValue(null);
    await chooseSavePath(null, LEXY, "My Paper.tex");
    expect(save).toHaveBeenLastCalledWith({ defaultPath: `${LEXY}\\My Paper.tex`, filters: texFilter });
  });

  it("asks the backend where a save really goes", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(`${LEXY}\\Thesis\\Thesis.tex`);
    await expect(prepareSavePath(`${LEXY}\\Thesis.tex`)).resolves.toBe(`${LEXY}\\Thesis\\Thesis.tex`);
    expect(invoke).toHaveBeenCalledWith("prepare_save_path", { path: `${LEXY}\\Thesis.tex` });
  });

  it.each([
    [String.raw`\title{My Paper}`, "My Paper.tex"],
    [String.raw`\title{Untitled}`, "Untitled.tex"],
    ["no title at all", "Untitled.tex"],
    [String.raw`\title{}`, "Untitled.tex"],
    [String.raw`\title{A \textbf{Bold} Idea}`, "A Bold Idea.tex"],
    [String.raw`\title{Q3: Results / Plans?}`, "Q3 Results Plans.tex"],
    [String.raw`\title{On \LaTeX{} and \\ line breaks}`, "On and line breaks.tex"],
    [String.raw`\title{Ends with dots...}`, "Ends with dots.tex"],
    [`\\title{${"x".repeat(80)}}`, `${"x".repeat(60)}.tex`],
  ])("suggestFileName(%j) → %s", (source, expected) => {
    expect(suggestFileName(source)).toBe(expected);
  });

  it("asks before discarding unsaved changes", async () => {
    vi.mocked(ask).mockResolvedValueOnce(false);
    await expect(confirmDiscard()).resolves.toBe(false);
    expect(ask).toHaveBeenCalledWith(
      "You have unsaved changes. Discard them?",
      expect.objectContaining({ kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" }),
    );
  });

  it.each([
    ["C:\\a\\main.tex", "C:\\a\\main.tex"],
    ["C:\\a\\MAIN.TEX", "C:\\a\\MAIN.TEX"],
    ["C:\\a\\main", "C:\\a\\main.tex"],
    ["C:\\a\\main.txt", "C:\\a\\main.txt.tex"],
  ])("withTexExtension(%s) → %s", (input, expected) => {
    expect(withTexExtension(input)).toBe(expected);
  });

  it.each([
    [null, "Untitled.tex"],
    ["C:\\Users\\me\\Thesis\\main.tex", "main.tex"],
    ["/home/me/paper.tex", "paper.tex"],
    ["plain.tex", "plain.tex"],
  ])("fileName(%s) → %s", (input, expected) => {
    expect(fileName(input)).toBe(expected);
  });
});

describe("defaultFolder", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(invoke).mockReset();
  });

  it("asks the backend once per session", async () => {
    vi.mocked(invoke).mockResolvedValue({ path: LEXY, fallback: false });
    const { defaultFolder } = await import("./documents");
    await expect(defaultFolder()).resolves.toEqual({ path: LEXY, fallback: false });
    await defaultFolder();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("default_document_folder");
  });

  it("retries after a failure", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("no folder").mockResolvedValueOnce({ path: "C:\\h", fallback: true });
    const { defaultFolder } = await import("./documents");
    await expect(defaultFolder()).rejects.toBe("no folder");
    await expect(defaultFolder()).resolves.toEqual({ path: "C:\\h", fallback: true });
  });
});
