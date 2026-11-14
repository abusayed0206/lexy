import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, MARGIN_PRESETS } from "./latex/settings";
import { Ribbon, type RibbonActions, type RibbonState } from "./Ribbon";

vi.mock("./latex/fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./latex/fonts")>()),
  listSystemFonts: vi.fn(() => Promise.resolve(["Arial", "Georgia"])),
}));

function makeActions(): RibbonActions {
  return {
    onNew: vi.fn(),
    onNewProject: vi.fn(),
    onOpen: vi.fn(),
    onHome: vi.fn(),
    onRecent: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onCompile: vi.fn(),
    onToggleLogs: vi.fn(),
    onToggleLive: vi.fn(),
    onToggleFiles: vi.fn(),
    onGit: vi.fn(),
    onShowInPdf: vi.fn(),
    onZoom: vi.fn(),
    onFormat: vi.fn(),
    onList: vi.fn(),
    onHeading: vi.fn(),
    onPageBreak: vi.fn(),
    onFootnote: vi.fn(),
    onEquation: vi.fn(),
    onTable: vi.fn(),
    onFont: vi.fn(),
    onSize: vi.fn(),
    onLayout: vi.fn(),
  };
}

const baseState: RibbonState = {
  fileName: "thesis.tex",
  path: "C:\\docs\\thesis.tex",
  unsaved: false,
  isMain: true,
  projectName: "Thesis",
  mainName: "thesis.tex",
  statusLabel: "PDF ready",
  statusClass: "ready",
  statusDetail: null,
  compiling: false,
  readOnly: false,
  logsOpen: false,
  liveEnabled: true,
  filesOpen: true,
  git: null,
  gitOpen: false,
  zoomLabel: "Fit",
  recent: [{ path: "D:\\Papers\\Survey", name: "Survey" }],
  settings: DEFAULT_SETTINGS,
  settingsManaged: true,
};

function setup(state: Partial<RibbonState> = {}) {
  const actions = makeActions();
  const user = userEvent.setup();
  const utils = render(<Ribbon actions={actions} state={{ ...baseState, ...state }} />);
  return { actions, user, ...utils };
}

const tab = (name: string) => screen.getByRole("tab", { name });

describe("Ribbon tabs", () => {
  beforeEach(() => localStorage.clear());

  it("shows File, Home, Insert, Layout, View with Home selected by default", () => {
    setup();
    expect(screen.getByRole("tablist", { name: "Ribbon" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["File", "Home", "Insert", "Layout", "View", "Git"]);
    expect(tab("Home")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Home" })).toBeVisible();
  });

  it("moves between tabs with arrows, Home and End (roving tabindex)", async () => {
    const { user } = setup();
    tab("Home").focus();
    await user.keyboard("{ArrowRight}");
    expect(tab("Insert")).toHaveFocus();
    expect(tab("Insert")).toHaveAttribute("aria-selected", "true");
    expect(tab("Insert")).toHaveAttribute("tabindex", "0");
    expect(tab("Home")).toHaveAttribute("tabindex", "-1");
    await user.keyboard("{End}");
    expect(tab("Git")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tab("File")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(tab("Git")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(tab("File")).toHaveFocus();
  });

  it("remembers the active tab and ignores a corrupt stored value", async () => {
    const { user, unmount } = setup();
    await user.click(tab("Layout"));
    expect(localStorage.getItem("lexy.ribbonTab")).toBe("layout");
    unmount();
    setup();
    expect(tab("Layout")).toHaveAttribute("aria-selected", "true");
  });

  it("falls back to Home for an unknown stored tab", () => {
    localStorage.setItem("lexy.ribbonTab", "nonsense");
    setup();
    expect(tab("Home")).toHaveAttribute("aria-selected", "true");
  });

  it("labels each panel by its tab", async () => {
    const { user } = setup();
    for (const name of ["File", "Insert", "Layout", "View"]) {
      await user.click(tab(name));
      expect(screen.getByRole("tabpanel", { name })).toBeVisible();
    }
  });
});

describe("Ribbon header", () => {
  beforeEach(() => localStorage.clear());

  it("always shows the file name, status and Compile", async () => {
    const { user, actions } = setup({ unsaved: true, statusLabel: "Preview failed", statusClass: "error", statusDetail: "Line 3: Undefined control sequence." });
    expect(screen.getByText("thesis.tex").parentElement).toHaveAttribute("title", "C:\\docs\\thesis.tex · Main: thesis.tex");
    expect(screen.getByText("Thesis")).toBeInTheDocument();
    expect(screen.getByText("Main")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Unsaved changes" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Preview failed");
    expect(screen.getByRole("status")).toHaveAttribute("title", "Line 3: Undefined control sequence.");
    await user.click(tab("Layout"));
    await user.click(screen.getByRole("button", { name: "Compile" }));
    expect(actions.onCompile).toHaveBeenCalled();
  });

  it("disables Compile while an explicit compile runs", () => {
    setup({ compiling: true });
    expect(screen.getByRole("button", { name: "Compiling" })).toBeDisabled();
  });

  it("disables Compile in a read-only project", () => {
    setup({ readOnly: true });
    expect(screen.getByRole("button", { name: "Compile" })).toBeDisabled();
  });
});

describe("Ribbon panels", () => {
  beforeEach(() => localStorage.clear());

  it("File tab runs file commands and shows their shortcuts", async () => {
    const { user, actions } = setup();
    await user.click(tab("File"));
    for (const [name, shortcut, action] of [
      ["New file", "Ctrl+N", actions.onNew],
      ["Open folder…", "Ctrl+O", actions.onOpen],
      ["Save", "Ctrl+S", actions.onSave],
      ["Save as", "Ctrl+Shift+S", actions.onSaveAs],
    ] as const) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("title", `${name} (${shortcut})`);
      await user.click(button);
      expect(action).toHaveBeenCalled();
    }
    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(actions.onNewProject).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Project Home" }));
    expect(actions.onHome).toHaveBeenCalled();
  });

  it("File → Recent projects opens another project", async () => {
    const { user, actions } = setup();
    await user.click(tab("File"));
    await user.click(screen.getByRole("button", { name: "Recent projects" }));
    await user.click(screen.getByRole("menuitem", { name: /Survey/ }));
    expect(actions.onRecent).toHaveBeenCalledWith("D:\\Papers\\Survey");
  });

  it("File tab disables writing commands in a read-only project", async () => {
    const { user } = setup({ readOnly: true });
    await user.click(tab("File"));
    for (const name of ["New file", "Save", "Save as"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open folder…" })).toBeEnabled();
  });

  it("Home tab formats text", async () => {
    const { user, actions } = setup();
    await user.click(screen.getByRole("button", { name: "Bold" }));
    await user.click(screen.getByRole("button", { name: "Italic" }));
    await user.click(screen.getByRole("button", { name: "Underline" }));
    expect(vi.mocked(actions.onFormat).mock.calls.map((c) => c[0])).toEqual(["textbf", "textit", "underline"]);
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("title", "Bold (Ctrl+B)");

    await user.click(screen.getByRole("button", { name: "Bullets" }));
    await user.click(screen.getByRole("button", { name: "Numbering" }));
    expect(vi.mocked(actions.onList).mock.calls.map((c) => c[0])).toEqual(["itemize", "enumerate"]);
  });

  it("Home → Styles applies headings", async () => {
    const { user, actions } = setup();
    await user.click(screen.getByRole("button", { name: "Styles" }));
    const menu = screen.getByRole("menu", { name: "Styles" });
    await user.click(within(menu).getByRole("menuitem", { name: /Heading 2/ }));
    expect(actions.onHeading).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Home → Size reflects and changes the base size", async () => {
    const { user, actions } = setup({ settings: { ...DEFAULT_SETTINGS, size: 11 } });
    const size = screen.getByRole("combobox", { name: "Font size" });
    expect(size).toHaveValue("11");
    await user.selectOptions(size, "12");
    expect(actions.onSize).toHaveBeenCalledWith(12);
  });

  it("Insert tab offers equation, page break and footnote", async () => {
    const { user, actions } = setup();
    await user.click(tab("Insert"));
    await user.click(screen.getByRole("button", { name: "Equation" }));
    await user.click(screen.getByRole("button", { name: "Page break" }));
    await user.click(screen.getByRole("button", { name: "Footnote" }));
    expect(actions.onEquation).toHaveBeenCalled();
    expect(actions.onPageBreak).toHaveBeenCalled();
    expect(actions.onFootnote).toHaveBeenCalled();
  });

  it("Layout tab marks the current margin preset and applies a new one", async () => {
    const { user, actions } = setup({ settings: { ...DEFAULT_SETTINGS, margins: MARGIN_PRESETS.moderate } });
    await user.click(tab("Layout"));
    await user.click(screen.getByRole("button", { name: "Margins" }));
    expect(screen.getByRole("menuitemradio", { name: /Moderate/ })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("menuitemradio", { name: /Narrow/ }));
    expect(actions.onLayout).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, margins: MARGIN_PRESETS.narrow });
  });

  it("View tab toggles live preview and logs and compiles", async () => {
    const { user, actions } = setup({ liveEnabled: true, logsOpen: true });
    await user.click(tab("View"));
    expect(screen.getByRole("button", { name: "Live preview" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Live preview" }));
    expect(actions.onToggleLive).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Hide logs" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Hide logs" }));
    expect(actions.onToggleLogs).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Compile now" }));
    expect(actions.onCompile).toHaveBeenCalled();
    const files = screen.getByRole("button", { name: "Files" });
    expect(files).toHaveAttribute("aria-pressed", "true");
    expect(files).toHaveAttribute("title", "Files (Ctrl+Shift+E)");
    await user.click(files);
    expect(actions.onToggleFiles).toHaveBeenCalled();
  });

  it("every control in every panel has an accessible name", async () => {
    const { user } = setup();
    for (const name of ["File", "Home", "Insert", "Layout", "View"]) {
      await user.click(tab(name));
      const panel = screen.getByRole("tabpanel", { name });
      for (const control of within(panel).queryAllByRole("button")) {
        expect(control).toHaveAccessibleName();
      }
      expect(within(panel).getAllByRole("group").length).toBeGreaterThan(0);
    }
  });
});
