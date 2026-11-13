import { describe, expect, it } from "vitest";
import { dirtyFiles, emptyOpenFiles, isDirty, openFilesReducer, type OpenFilesEvent, type OpenFilesState } from "./openFiles";

function run(...events: OpenFilesEvent[]): OpenFilesState {
  return events.reduce(openFilesReducer, emptyOpenFiles);
}

const withMain = (): OpenFilesState =>
  run({ type: "mainSet", path: "main.tex" }, { type: "opened", path: "main.tex", text: "M" }, { type: "opened", path: "chapters\\intro.tex", text: "I" });

describe("openFilesReducer", () => {
  it("opened adds a clean file and makes it current; opening again just switches", () => {
    const state = withMain();
    expect(state.current).toBe("chapters\\intro.tex");
    expect(isDirty(state.files.get("main.tex"))).toBe(false);
    const again = openFilesReducer({ ...state, files: new Map(state.files) }, { type: "opened", path: "MAIN.TEX", text: "other" });
    expect(again.current).toBe("main.tex");
    expect(again.files.get("main.tex")?.text).toBe("M");
  });

  it("switched changes the current file, case-insensitively, and ignores unknown files", () => {
    const state = withMain();
    expect(openFilesReducer(state, { type: "switched", path: "Main.tex" }).current).toBe("main.tex");
    expect(openFilesReducer(state, { type: "switched", path: "nope.tex" })).toBe(state);
  });

  it("edited marks dirty; saved clears it; editing back to the saved text is clean", () => {
    let state = openFilesReducer(withMain(), { type: "edited", path: "main.tex", text: "M2" });
    expect(dirtyFiles(state)).toEqual(["main.tex"]);
    state = openFilesReducer(state, { type: "edited", path: "main.tex", text: "M" });
    expect(dirtyFiles(state)).toEqual([]);
    state = openFilesReducer(state, { type: "edited", path: "main.tex", text: "M3" });
    state = openFilesReducer(state, { type: "saved", path: "main.tex", text: "M3" });
    expect(dirtyFiles(state)).toEqual([]);
  });

  it("saving older text keeps later edits dirty", () => {
    let state = openFilesReducer(withMain(), { type: "edited", path: "main.tex", text: "M2" });
    state = openFilesReducer(state, { type: "edited", path: "main.tex", text: "M23" });
    state = openFilesReducer(state, { type: "saved", path: "main.tex", text: "M2" });
    expect(dirtyFiles(state)).toEqual(["main.tex"]);
  });

  it("lists dirty files with the current one first", () => {
    let state = openFilesReducer(withMain(), { type: "edited", path: "main.tex", text: "x" });
    state = openFilesReducer(state, { type: "edited", path: "chapters\\intro.tex", text: "y" });
    expect(dirtyFiles(state)).toEqual(["chapters\\intro.tex", "main.tex"]);
  });

  it("diskChanged only flags dirty files; reloaded and keptMine clear it", () => {
    const clean = openFilesReducer(withMain(), { type: "diskChanged", path: "main.tex" });
    expect(clean.files.get("main.tex")?.diskChanged).toBe(false);
    let state = openFilesReducer(withMain(), { type: "edited", path: "main.tex", text: "mine" });
    state = openFilesReducer(state, { type: "diskChanged", path: "main.tex" });
    expect(state.files.get("main.tex")?.diskChanged).toBe(true);
    const kept = openFilesReducer(state, { type: "keptMine", path: "main.tex" });
    expect(kept.files.get("main.tex")).toMatchObject({ diskChanged: false, text: "mine" });
    const reloaded = openFilesReducer(state, { type: "reloaded", path: "main.tex", text: "disk" });
    expect(reloaded.files.get("main.tex")).toEqual({ savedText: "disk", text: "disk", diskChanged: false });
  });

  it("renaming a folder renames every open file under it, plus current and main", () => {
    const state = openFilesReducer(withMain(), { type: "renamed", from: "chapters", to: "parts" });
    expect([...state.files.keys()]).toEqual(["main.tex", "parts\\intro.tex"]);
    expect(state.current).toBe("parts\\intro.tex");
    const main = openFilesReducer(state, { type: "renamed", from: "main.tex", to: "thesis.tex" });
    expect(main.main).toBe("thesis.tex");
    expect(openFilesReducer(state, { type: "renamed", from: "chapter", to: "x" }).current).toBe("parts\\intro.tex");
  });

  it("deleting the current file switches to the main document", () => {
    const state = openFilesReducer(withMain(), { type: "deleted", path: "chapters" });
    expect(state.current).toBe("main.tex");
    expect(state.files.has("chapters\\intro.tex")).toBe(false);
  });

  it("deleting the main document clears main", () => {
    const state = openFilesReducer(withMain(), { type: "deleted", path: "main.tex" });
    expect(state.main).toBeNull();
    expect(state.current).toBe("chapters\\intro.tex");
  });

  it("the main document can't be closed; other files can", () => {
    const state = withMain();
    expect(openFilesReducer(state, { type: "closed", path: "main.tex" })).toBe(state);
    const closed = openFilesReducer(state, { type: "closed", path: "chapters\\intro.tex" });
    expect(closed.current).toBe("main.tex");
    expect(closed.files.size).toBe(1);
  });
});
