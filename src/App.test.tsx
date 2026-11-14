import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import type { OpenedProject } from "./projects";
import type { EnvironmentStatus } from "./SetupScreen";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: () => Promise.resolve(() => {}) }),
}));
vi.mock("./PdfView", () => ({ PdfView: () => <div>No PDF yet</div> }));
vi.mock("./Editor", () => ({
  Editor: ({ value, label }: { value: string; label: string }) => <textarea aria-label={label} value={value} readOnly />,
}));
const invokeMock = vi.mocked(invoke);

const tool = (name: string, installed: boolean) => ({
  name,
  installed,
  version: installed ? `${name} 1.0` : null,
  path: installed ? `C:\\tools\\${name}.exe` : null,
  message: installed ? `${name} is available.` : `${name} was not found.`,
});

const readyEnv: EnvironmentStatus = {
  ready: true,
  miktex: tool("MiKTeX", true),
  perl: tool("Strawberry Perl", true),
  latexmk: tool("latexmk", true),
};
const missingEnv: EnvironmentStatus = { ...readyEnv, ready: false, perl: tool("Strawberry Perl", false) };
const THESIS: OpenedProject = { root: "C:\\Docs\\Lexy\\Thesis", name: "Thesis", readOnly: false, mainDocument: "Thesis.tex", candidates: ["Thesis.tex"] };

/** Answers backend commands by name; `environment` may be a promise or a sequence. */
function backend({ environment = [readyEnv], lastOpen = null as string | null } = {}) {
  const environments = [...environment];
  invokeMock.mockImplementation(async (command: string) => {
    switch (command) {
      case "check_environment": {
        const next = environments.length > 1 ? environments.shift()! : environments[0];
        if (typeof next === "string") throw next;
        return next;
      }
      case "start_initial_setup":
        return environments[environments.length - 1];
      case "last_open_project":
        return lastOpen;
      case "open_project":
        return THESIS;
      case "read_file":
        return "\\documentclass{article}";
      case "list_projects":
        return [];
      case "list_dir":
        return [];
      case "default_document_folder":
        return { path: "C:\\Docs\\Lexy", fallback: false };
      default:
        return undefined;
    }
  });
}

describe("App gate", () => {
  beforeEach(() => invokeMock.mockReset());

  it("shows Checking tools until the environment check returns", async () => {
    let resolve!: (value: EnvironmentStatus) => void;
    invokeMock.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking tools");
    expect(invokeMock).toHaveBeenCalledWith("check_environment");

    backend();
    await act(async () => resolve(readyEnv));
    expect(await screen.findByRole("heading", { name: "Lexy" })).toBeInTheDocument();
  });

  it("shows Project Home when no project was open last time", async () => {
    backend();
    render(<App />);
    expect(await screen.findByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "LaTeX source" })).not.toBeInTheDocument();
  });

  it("reopens the last project straight into the writer", async () => {
    backend({ lastOpen: THESIS.root });
    render(<App />);
    const source = await screen.findByRole("textbox", { name: "LaTeX source" });
    await waitFor(() => expect(source).toHaveValue("\\documentclass{article}"));
    expect(invokeMock).toHaveBeenCalledWith("open_project", { path: THESIS.root });
  });

  it("falls back to Project Home with a notice when the last project can't be opened", async () => {
    backend({ lastOpen: THESIS.root });
    const route = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "open_project") throw { kind: "notFound", message: "gone" };
      return route(command, args as never);
    });
    render(<App />);
    expect(await screen.findByText("Could not reopen the last project. gone")).toBeInTheDocument();
  });

  it("shows setup when a tool is missing", async () => {
    backend({ environment: [missingEnv] });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Install LaTeX tools" })).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("last_open_project");
  });

  it("shows setup with the error when the environment check fails", async () => {
    invokeMock.mockRejectedValueOnce("probe crashed");
    render(<App />);
    expect(await screen.findByText("probe crashed")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Install LaTeX tools" })).toBeInTheDocument();
  });

  it("moves to Project Home after a successful Recheck, clearing the error", async () => {
    const user = userEvent.setup();
    invokeMock.mockRejectedValueOnce("probe crashed");
    render(<App />);
    backend();
    await user.click(await screen.findByRole("button", { name: "Recheck" }));
    expect(await screen.findByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.queryByText("probe crashed")).not.toBeInTheDocument();
  });

  it("moves on after setup finishes without a restart", async () => {
    const user = userEvent.setup();
    backend({ environment: [missingEnv, readyEnv] });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Install missing tools" }));
    expect(invokeMock).toHaveBeenCalledWith("start_initial_setup");
    expect(await screen.findByRole("button", { name: "New project" })).toBeInTheDocument();
  });

  it("opens a project from Project Home and returns via File → Project Home", async () => {
    const user = userEvent.setup();
    backend();
    const route = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation(async (command: string, args?: unknown) =>
      command === "list_projects"
        ? [{ path: THESIS.root, name: "Thesis", modified: Date.now(), lastOpened: null, inDefaultFolder: true, missing: false }]
        : route(command, args as never),
    );
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Thesis/ }));
    expect(await screen.findByRole("textbox", { name: "LaTeX source" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "File" }));
    await user.click(screen.getByRole("button", { name: "Project Home" }));
    expect(await screen.findByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("close_project");
  });
});
