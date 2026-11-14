import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { defaultFolder } from "./documents";
import { ProjectHome, relativeDate } from "./ProjectHome";
import { countEntries, createProject, forgetProject, listProjects, type ProjectSummary } from "./projects";
import { STARTER_DOCUMENT } from "./starter";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./documents", () => ({ defaultFolder: vi.fn() }));
vi.mock("./projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./projects")>()),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  countEntries: vi.fn(),
  forgetProject: vi.fn(),
}));

const LEXY = "C:\\Users\\me\\Documents\\Lexy";
const now = Date.now();
const projects: ProjectSummary[] = [
  { path: `${LEXY}\\Thesis`, name: "Thesis", modified: now, lastOpened: now, inDefaultFolder: true, missing: false },
  { path: "D:\\Papers\\Survey", name: "Survey", modified: now - 3 * 86400000, lastOpened: now - 3 * 86400000, inDefaultFolder: false, missing: false },
  { path: "Z:\\Gone", name: "Gone", modified: 0, lastOpened: 1, inDefaultFolder: false, missing: true },
];

describe("relativeDate", () => {
  const noon = new Date(2026, 10, 13, 12).getTime();
  it.each([
    [noon - 60_000, "Today"],
    [noon - 20 * 3600_000, "Yesterday"],
    [noon - 3 * 86400_000, "3 days ago"],
    [0, ""],
  ])("relativeDate(%s)", (ms, expected) => {
    expect(relativeDate(ms, noon)).toBe(expected);
  });

  it("uses a short date for older projects", () => {
    expect(relativeDate(noon - 30 * 86400_000, noon)).not.toMatch(/ago|Today|Yesterday/);
  });
});

describe("ProjectHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listProjects).mockResolvedValue(projects);
    vi.mocked(defaultFolder).mockResolvedValue({ path: LEXY, fallback: false });
    vi.mocked(countEntries).mockResolvedValue(10);
  });

  function setup() {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    render(<ProjectHome onOpen={onOpen} />);
    return { onOpen, user };
  }

  it("lists projects newest first with dates, outside locations and Missing rows", async () => {
    setup();
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "ThesisToday",
      "SurveyD:\\Papers3 days ago",
      "GoneZ:Missing" + "Remove from list",
    ]);
    expect(screen.getByRole("button", { name: /Gone/ })).toBeDisabled();
  });

  it("opens a project on click", async () => {
    const { onOpen, user } = setup();
    await user.click(await screen.findByRole("button", { name: /Thesis/ }));
    expect(onOpen).toHaveBeenCalledWith(`${LEXY}\\Thesis`);
  });

  it("moves between rows with the arrow keys", async () => {
    const { user } = setup();
    const thesis = await screen.findByRole("button", { name: /Thesis/ });
    thesis.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: /Survey/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(thesis).toHaveFocus();
  });

  it("removes a missing project from the list", async () => {
    const { user } = setup();
    vi.mocked(forgetProject).mockResolvedValue(undefined);
    await user.click(await screen.findByRole("button", { name: "Remove from list" }));
    expect(forgetProject).toHaveBeenCalledWith("Z:\\Gone");
    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(2));
  });

  it("creates a project with the starter document (Enter creates, Esc cancels)", async () => {
    const { onOpen, user } = setup();
    vi.mocked(createProject).mockResolvedValue(`${LEXY}\\Paper`);
    await user.click(screen.getByRole("button", { name: "New project" }));
    const field = screen.getByRole("textbox", { name: "Project name" });
    expect(field).toHaveValue("Untitled");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Project name" })).not.toBeInTheDocument();

    await user.keyboard("{Control>}n{/Control}");
    await user.clear(screen.getByRole("textbox", { name: "Project name" }));
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "Paper{Enter}");
    expect(createProject).toHaveBeenCalledWith("Paper", STARTER_DOCUMENT);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(`${LEXY}\\Paper`));
  });

  it("refuses names Windows forbids", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.clear(screen.getByRole("textbox", { name: "Project name" }));
    await user.type(screen.getByRole("textbox", { name: "Project name" }), "a:b{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent('Use a name without \\ / : * ? " < > |');
    expect(createProject).not.toHaveBeenCalled();
  });

  it("opens any folder, asking first when it is large", async () => {
    const { onOpen, user } = setup();
    vi.mocked(open).mockResolvedValue("D:\\Huge");
    vi.mocked(countEntries).mockResolvedValue(5001);
    await user.click(screen.getByRole("button", { name: "Open folder…" }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, defaultPath: LEXY }));
    expect(await screen.findByText("This folder is large. Open anyway?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpen).not.toHaveBeenCalled();

    vi.mocked(countEntries).mockResolvedValue(12);
    await user.keyboard("{Control>}o{/Control}");
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("D:\\Huge"));
  });

  it("shows the fallback folder notice and app notices", async () => {
    vi.mocked(defaultFolder).mockResolvedValue({ path: "C:\\Users\\me", fallback: true });
    render(<ProjectHome onOpen={vi.fn()} notice="Could not open the project. gone" />);
    expect(await screen.findByText("Saving to C:\\Users\\me because Documents isn't available.")).toBeInTheDocument();
    expect(screen.getByText("Could not open the project. gone")).toBeInTheDocument();
  });
});
