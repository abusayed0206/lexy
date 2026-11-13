import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  absolutePath,
  baseName,
  compileProject,
  errorText,
  importFiles,
  isProjectError,
  isWithin,
  joinRel,
  openProject,
  parentOf,
  sameRel,
  validName,
  writeFile,
} from "./projects";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("project commands", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("send camelCase arguments to the backend", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await openProject("D:\Thesis");
    await writeFile("chapters\intro.tex", "text");
    await importFiles(["C:\fig.png"], "images", "ask");
    await compileProject("main.tex", [{ path: "chapters\intro.tex", text: "x" }]);
    expect(invoke).toHaveBeenNthCalledWith(1, "open_project", { path: "D:\Thesis" });
    expect(invoke).toHaveBeenNthCalledWith(2, "write_file", { rel: "chapters\intro.tex", contents: "text" });
    expect(invoke).toHaveBeenNthCalledWith(3, "import_files", { sources: ["C:\fig.png"], targetDir: "images", onConflict: "ask" });
    expect(invoke).toHaveBeenNthCalledWith(4, "compile_project", { main: "main.tex", buffers: [{ path: "chapters\intro.tex", text: "x" }] });
  });
});

describe("errors", () => {
  it("recognises structured project errors and reads any error as text", () => {
    const error = { kind: "nameTaken", message: "x already exists" };
    expect(isProjectError(error)).toBe(true);
    expect(isProjectError(error, "nameTaken")).toBe(true);
    expect(isProjectError(error, "io")).toBe(false);
    expect(isProjectError("plain")).toBe(false);
    expect(errorText(error)).toBe("x already exists");
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText("text")).toBe("text");
  });
});

describe("path helpers", () => {
  it("join, split and compare project-relative paths", () => {
    expect(joinRel("", "a.tex")).toBe("a.tex");
    expect(joinRel("chapters", "a.tex")).toBe("chapters\\a.tex");
    expect(parentOf("chapters\\a.tex")).toBe("chapters");
    expect(parentOf("a.tex")).toBe("");
    expect(baseName("chapters\\a.tex")).toBe("a.tex");
    expect(sameRel("Chapters/A.tex", "chapters\\a.tex")).toBe(true);
    expect(sameRel(null, "a")).toBe(false);
    expect(isWithin("chapters\\a.tex", "chapters")).toBe(true);
    expect(isWithin("chapters", "chapters")).toBe(true);
    expect(isWithin("chapters2\\a.tex", "chapters")).toBe(false);
    expect(absolutePath("D:\\Thesis\\", "main.tex")).toBe("D:\\Thesis\\main.tex");
  });

  it.each([
    ["intro.tex", true],
    ["Chapter 1", true],
    ["", false],
    ["a:b", false],
    ["name.", false],
    ["CON", false],
    ["con.txt", false],
    ["x/y", false],
  ])("validName(%j) → %s", (name, expected) => {
    expect(validName(name)).toBe(expected);
  });
});
