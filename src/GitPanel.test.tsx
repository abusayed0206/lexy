import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as git from "./git";
import { GitPanel, stateLine, type GitAction } from "./GitPanel";
import type { GitState } from "./git";

vi.mock("./git", async (importOriginal) => {
  const real = await importOriginal<typeof import("./git")>();
  const names = Object.keys(real).filter((name) => name.startsWith("git"));
  return { ...real, ...Object.fromEntries(names.map((name) => [name, vi.fn()])) };
});
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

const mocked = vi.mocked(git);
const base: GitState = {
  installed: true,
  repo: "own",
  repoRoot: null,
  branch: "main",
  remoteUrl: null,
  ahead: 0,
  behind: 0,
  changes: [],
  merging: false,
  readOnly: false,
};
const changed = (extra: Partial<GitState> = {}): GitState => ({
  ...base,
  changes: [{ path: "main.tex", oldPath: null, status: "modified", size: 10 }],
  ...extra,
});

function setup(state: GitState | null, request: { action: GitAction; seq: number } | null = null) {
  const props = {
    state,
    projectName: "My Thesis",
    request,
    refresh: vi.fn(() => Promise.resolve()),
    saveAll: vi.fn(() => Promise.resolve(true)),
    confirmRestoreFile: vi.fn(() => Promise.resolve(true)),
    reloadFiles: vi.fn(() => Promise.resolve()),
    ask: vi.fn(() => Promise.resolve(null)) as never,
    prompt: vi.fn(() => Promise.resolve(null)) as ReturnType<typeof vi.fn>,
    onClose: vi.fn(),
  };
  const view = render(<GitPanel {...props} />);
  return { props, view };
}

beforeEach(() => vi.clearAllMocks());

describe("stateLine", () => {
  it("describes each state in one line", () => {
    expect(stateLine({ ...base, installed: false })).toMatch(/Git for Windows is needed/);
    expect(stateLine({ ...base, repo: "none" })).toBe("No history yet.");
    expect(stateLine(base)).toBe("Nothing to commit");
    expect(stateLine(changed({ ahead: 2, behind: 1 }))).toBe("1 change · 2 to push · 1 to pull");
    expect(stateLine(changed({ changes: [{ path: "a", oldPath: null, status: "conflicted", size: 1 }] }))).toBe("Conflicts in 1 file.");
  });
});

describe("GitPanel", () => {
  it("starts version history after saving", async () => {
    mocked.gitInit.mockResolvedValue(base);
    const { props } = setup({ ...base, repo: "none", branch: null });
    await userEvent.click(screen.getByRole("button", { name: "Start version history" }));
    await waitFor(() => expect(mocked.gitInit).toHaveBeenCalled());
    expect(props.saveAll).toHaveBeenCalled();
    expect(await screen.findByText("Version history started.")).toBeTruthy();
  });

  it("disables Commit when there is nothing to commit or the window is read-only", () => {
    const { view } = setup(base);
    expect(screen.getByRole("button", { name: "Commit" })).toHaveProperty("disabled", true);
    view.unmount();
    setup(changed({ readOnly: true }));
    expect(screen.getByRole("button", { name: "Commit" })).toHaveProperty("disabled", true);
  });

  it("commits with Ctrl+Enter after saving, asking for an identity once", async () => {
    mocked.gitCommit.mockRejectedValueOnce({ kind: "needsIdentity", message: "x" }).mockResolvedValue({ id: "abc", message: "Chapter 1" });
    mocked.gitSetIdentity.mockResolvedValue(undefined);
    const { props } = setup(changed());
    props.prompt.mockResolvedValueOnce("Ann").mockResolvedValueOnce("ann@example.com");
    await userEvent.type(screen.getByLabelText("Commit message"), "Chapter 1{Control>}{Enter}{/Control}");
    expect(await screen.findByText("Committed: Chapter 1")).toBeTruthy();
    expect(props.saveAll).toHaveBeenCalled();
    expect(mocked.gitSetIdentity).toHaveBeenCalledWith("Ann", "ann@example.com");
    expect(mocked.gitCommit).toHaveBeenCalledTimes(2);
    expect(props.refresh).toHaveBeenCalled();
  });

  it("shows the line diff of a selected change", async () => {
    mocked.gitDiff.mockResolvedValue({ binary: false, oldSize: null, newSize: null, patch: "@@ -1 +1 @@\n-old line\n+new line\n" });
    setup(changed());
    await userEvent.click(screen.getByRole("button", { name: /main\.tex/ }));
    expect(await screen.findByText(/old line/)).toBeTruthy();
    expect(screen.getByText(/new line/).closest("tr")?.className).toBe("diff-add");
  });

  it("offers Pull when someone else pushed first", async () => {
    mocked.gitPush.mockRejectedValue({ kind: "rejected", message: "Someone else pushed changes. Pull first." });
    setup({ ...base, remoteUrl: "https://github.com/u/r.git", ahead: 1 }, { action: "push", seq: 1 });
    expect(await screen.findByText(/Pull first/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pull" })).toBeTruthy();
  });

  it("sync stops when the pull ends in conflicts", async () => {
    mocked.gitPull.mockResolvedValue({ pulled: 1, conflicts: ["main.tex"] });
    const { props } = setup({ ...base, remoteUrl: "https://github.com/u/r.git" }, { action: "sync", seq: 1 });
    expect(await screen.findByText(/Conflicts in 1 file/)).toBeTruthy();
    expect(mocked.gitPush).not.toHaveBeenCalled();
    expect(props.reloadFiles).toHaveBeenCalledWith("all");
  });

  it("resolves conflicts per file", async () => {
    mocked.gitResolve.mockResolvedValue(base);
    const { props } = setup(changed({ merging: true, changes: [{ path: "ch.tex", oldPath: null, status: "conflicted", size: 1 }] }));
    await userEvent.click(screen.getByRole("button", { name: "Keep theirs" }));
    await waitFor(() => expect(mocked.gitResolve).toHaveBeenCalledWith("ch.tex", "theirs"));
    expect(props.reloadFiles).toHaveBeenCalledWith(["ch.tex"]);
    expect(screen.getByRole("button", { name: "Commit" })).toHaveProperty("disabled", true);
  });
});
