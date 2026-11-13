import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
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

describe("App gate", () => {
  beforeEach(() => invokeMock.mockReset());

  it("shows Checking tools until the environment check returns", async () => {
    let resolve!: (value: EnvironmentStatus) => void;
    invokeMock.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking tools");
    expect(invokeMock).toHaveBeenCalledWith("check_environment");

    await act(async () => resolve(readyEnv));
    expect(screen.getByRole("textbox", { name: "LaTeX source" })).toBeInTheDocument();
  });

  it("opens the writer directly when all tools are present", async () => {
    invokeMock.mockResolvedValue(readyEnv);
    render(<App />);
    expect(await screen.findByRole("textbox", { name: "LaTeX source" })).toBeInTheDocument();
    expect(screen.queryByText("LaTeX tools")).not.toBeInTheDocument();
  });

  it("shows setup when a tool is missing", async () => {
    invokeMock.mockResolvedValue(missingEnv);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Install LaTeX tools" })).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "LaTeX source" })).not.toBeInTheDocument();
  });

  it("shows setup with the error when the environment check fails", async () => {
    invokeMock.mockRejectedValueOnce("probe crashed");
    render(<App />);
    expect(await screen.findByText("probe crashed")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Install LaTeX tools" })).toBeInTheDocument();
  });

  it("moves to the writer after a successful Recheck, clearing the error", async () => {
    const user = userEvent.setup();
    invokeMock.mockRejectedValueOnce("probe crashed").mockResolvedValueOnce(readyEnv);
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Recheck" }));
    expect(await screen.findByRole("textbox", { name: "LaTeX source" })).toBeInTheDocument();
    expect(screen.queryByText("probe crashed")).not.toBeInTheDocument();
  });

  it("moves to the writer after setup finishes without a restart", async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValueOnce(missingEnv).mockResolvedValueOnce(readyEnv);
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Install missing tools" }));
    expect(invokeMock).toHaveBeenCalledWith("start_initial_setup");
    expect(await screen.findByRole("textbox", { name: "LaTeX source" })).toBeInTheDocument();
  });
});
