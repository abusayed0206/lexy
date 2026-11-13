import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listDir, type Entry } from "./projects";
import { Sidebar, type SidebarActions } from "./Sidebar";

vi.mock("./projects", async (importOriginal) => ({ ...(await importOriginal<typeof import("./projects")>()), listDir: vi.fn() }));

type DropHandler = (event: { payload: { type: string; paths?: string[]; position?: { x: number; y: number } } }) => void;
let dropHandler: DropHandler | null = null;
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: DropHandler) => {
      dropHandler = handler;
      return Promise.resolve(() => (dropHandler = null));
    },
  }),
}));

const entry = (path: string, kind: "file" | "folder" = "file", hidden = false): Entry => ({
  path,
  name: path.slice(path.lastIndexOf("\\") + 1),
  kind,
  editable: /\.(tex|bib)$/.test(path),
  hidden,
  modified: 0,
});

const TREE: Record<string, Entry[]> = {
  "": [entry("chapters", "folder"), entry("images", "folder"), entry("main.aux", "file", true), entry("main.tex"), entry("refs.bib")],
  chapters: [entry("chapters\\intro.tex")],
  images: [entry("images\\fig.png")],
};

function actions(): SidebarActions {
  return {
    onOpen: vi.fn(),
    onNewFile: vi.fn(),
    onNewFolder: vi.fn(),
    onRename: vi.fn(() => Promise.resolve(true)),
    onDelete: vi.fn(),
    onSetMain: vi.fn(),
    onReveal: vi.fn(),
    onHome: vi.fn(),
    onImport: vi.fn(),
    onError: vi.fn(),
  };
}

function setup(props: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const handlers = actions();
  const user = userEvent.setup();
  const utils = render(
    <Sidebar
      projectName="Thesis"
      version={0}
      current="main.tex"
      main="main.tex"
      dirty={new Set()}
      readOnly={false}
      actions={handlers}
      {...props}
    />,
  );
  return { handlers, user, ...utils };
}

const row = (name: string) => screen.getByRole("treeitem", { name });
const names = () => screen.getAllByRole("treeitem").map((item) => item.getAttribute("aria-label"));

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(listDir).mockImplementation((rel) => Promise.resolve(TREE[rel] ?? []));
  });

  it("lists the root lazily, folders first, hiding build files", async () => {
    setup();
    await screen.findByRole("treeitem", { name: "main.tex" });
    expect(names()).toEqual(["chapters", "images", "main.tex", "refs.bib"]);
    expect(listDir).toHaveBeenCalledTimes(1);
    expect(row("main.tex")).toHaveAttribute("aria-selected", "true");
    expect(within(row("main.tex")).getByText("Main")).toBeInTheDocument();
  });

  it("expands folders on demand and opens files", async () => {
    const { handlers, user } = setup();
    await user.click(await screen.findByRole("treeitem", { name: "chapters" }));
    expect(await screen.findByRole("treeitem", { name: "intro.tex" })).toHaveAttribute("aria-level", "2");
    expect(listDir).toHaveBeenCalledWith("chapters");
    expect(row("chapters")).toHaveAttribute("aria-expanded", "true");
    await user.click(row("intro.tex"));
    expect(handlers.onOpen).toHaveBeenCalledWith(TREE.chapters[0]);
  });

  it("shows hidden files from the … menu", async () => {
    const { user } = setup();
    await screen.findByRole("treeitem", { name: "main.tex" });
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Show hidden files" }));
    expect(names()).toContain("main.aux");
  });

  it("marks unsaved files and folders that contain them", async () => {
    setup({ dirty: new Set(["chapters\\intro.tex", "refs.bib"]) });
    await screen.findByRole("treeitem", { name: "main.tex" });
    expect(within(row("refs.bib")).getByRole("img", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(within(row("chapters")).getByRole("img", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(within(row("main.tex")).queryByRole("img", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("supports the tree keyboard pattern", async () => {
    const { handlers, user } = setup();
    const chapters = await screen.findByRole("treeitem", { name: "chapters" });
    act(() => chapters.focus());
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("treeitem", { name: "intro.tex" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(row("intro.tex")).toHaveFocus());
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(row("chapters")).toHaveFocus());
    await user.keyboard("{ArrowLeft}");
    expect(row("chapters")).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{End}");
    await waitFor(() => expect(row("refs.bib")).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(handlers.onOpen).toHaveBeenCalledWith(TREE[""][4]);
    await user.keyboard("{Delete}");
    expect(handlers.onDelete).toHaveBeenCalledWith(TREE[""][4]);
  });

  it("renames inline with F2; Esc cancels", async () => {
    const { handlers, user } = setup();
    const bib = await screen.findByRole("treeitem", { name: "refs.bib" });
    act(() => bib.focus());
    await user.keyboard("{F2}");
    const field = screen.getByRole("textbox", { name: "Rename refs.bib" });
    await user.keyboard("{Escape}");
    expect(field).not.toBeInTheDocument();
    act(() => row("refs.bib").focus());
    await user.keyboard("{F2}");
    await user.clear(screen.getByRole("textbox", { name: "Rename refs.bib" }));
    await user.type(screen.getByRole("textbox", { name: "Rename refs.bib" }), "sources.bib{Enter}");
    expect(handlers.onRename).toHaveBeenCalledWith(TREE[""][4], "sources.bib");
  });

  it("offers the context menu by right-click and Shift+F10", async () => {
    const { handlers, user } = setup();
    const intro = await screen.findByRole("treeitem", { name: "refs.bib" });
    await user.pointer({ keys: "[MouseRight]", target: intro });
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Open",
      "Rename",
      "Delete",
      "New file here",
      "New folder here",
      "Open in Explorer",
    ]);
    await user.click(screen.getByRole("menuitem", { name: "New file here" }));
    expect(handlers.onNewFile).toHaveBeenCalledWith("");

    await user.click(row("chapters"));
    const chapterFile = await screen.findByRole("treeitem", { name: "intro.tex" });
    act(() => chapterFile.focus());
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(screen.getByRole("menuitem", { name: "Set as main document" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Set as main document" }));
    expect(handlers.onSetMain).toHaveBeenCalledWith("chapters\\intro.tex");
  });

  it("disables writing actions when read-only", async () => {
    const { user } = setup({ readOnly: true });
    await screen.findByRole("treeitem", { name: "main.tex" });
    expect(screen.getByRole("button", { name: "New file" })).toBeDisabled();
    await user.pointer({ keys: "[MouseRight]", target: row("refs.bib") });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Open in Explorer" })).toBeEnabled();
  });

  it("re-lists loaded folders when the version changes", async () => {
    const { rerender, handlers } = setup();
    await screen.findByRole("treeitem", { name: "main.tex" });
    TREE[""] = [...TREE[""], entry("new.tex")];
    rerender(<Sidebar projectName="Thesis" version={1} current={null} main="main.tex" dirty={new Set()} readOnly={false} actions={handlers} />);
    expect(await screen.findByRole("treeitem", { name: "new.tex" })).toBeInTheDocument();
    TREE[""] = TREE[""].slice(0, -1);
  });

  it("imports files dropped on a folder row, or on the file's folder", async () => {
    const { handlers } = setup();
    await screen.findByRole("treeitem", { name: "main.tex" });
    await waitFor(() => expect(dropHandler).not.toBeNull());
    const original = document.elementFromPoint;
    document.elementFromPoint = () => row("images");
    act(() => dropHandler!({ payload: { type: "over", position: { x: 5, y: 5 } } }));
    expect(row("images")).toHaveClass("drop-target");
    act(() => dropHandler!({ payload: { type: "drop", paths: ["C:\\fig.png"], position: { x: 5, y: 5 } } }));
    expect(handlers.onImport).toHaveBeenCalledWith(["C:\\fig.png"], "images");
    document.elementFromPoint = () => row("refs.bib");
    act(() => dropHandler!({ payload: { type: "drop", paths: ["C:\\a.bib"], position: { x: 5, y: 5 } } }));
    expect(handlers.onImport).toHaveBeenLastCalledWith(["C:\\a.bib"], "");
    document.elementFromPoint = () => document.body;
    act(() => dropHandler!({ payload: { type: "drop", paths: ["C:\\b.png"], position: { x: 5, y: 5 } } }));
    expect(handlers.onImport).toHaveBeenCalledTimes(2);
    document.elementFromPoint = original;
  });
});
