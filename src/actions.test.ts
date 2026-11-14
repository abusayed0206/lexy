import { describe, expect, it, vi } from "vitest";
import { fuzzyMatch, ribbonCommands, searchActions, type Action } from "./actions";
import type { RibbonActions } from "./Ribbon";

const action = (title: string, enabled = true): Action => ({ id: title, title, group: "Test", run: () => {}, enabled: () => enabled });

describe("fuzzyMatch", () => {
  it("matches subsequences case-insensitively", () => {
    expect(fuzzyMatch("intab", "Insert table")).not.toBeNull();
    expect(fuzzyMatch("xyz", "Insert table")).toBeNull();
    expect(fuzzyMatch("", "Anything")).toBe(0);
  });

  it("prefers word starts and consecutive letters", () => {
    expect(fuzzyMatch("tab", "Insert table")!).toBeGreaterThan(fuzzyMatch("tab", "Stable output")!);
  });
});

describe("searchActions", () => {
  it("ranks the best match first and hides disabled actions", () => {
    const list = [action("Page break"), action("Insert table"), action("Table of contents", false), action("Save")];
    expect(searchActions(list, "table").map((a) => a.title)).toEqual(["Insert table"]);
    expect(searchActions(list, "").map((a) => a.title)).toHaveLength(3);
  });

  it("also matches on the group name", () => {
    expect(searchActions([{ ...action("Push"), group: "Git" }], "git push").map((a) => a.title)).toEqual(["Push"]);
  });
});

describe("ribbonCommands", () => {
  it("lists every ribbon command once and wires it to the ribbon handler", () => {
    const run = new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
      get: (target, key: string) => (target[key] ??= vi.fn()),
    });
    const commands = ribbonCommands(run as unknown as RibbonActions);
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
    commands.find((c) => c.id === "home.bold")!.run();
    expect(run.onFormat).toHaveBeenCalledWith("textbf");
    commands.find((c) => c.id === "git.push")!.run();
    expect(run.onGit).toHaveBeenCalledWith("push");
    expect(commands.find((c) => c.id === "view.compile")!.shortcut).toBe("F5");
  });
});
