import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS, SettingsProvider, useSettings } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

function Probe() {
  const { settings, update } = useSettings();
  return (
    <button type="button" onClick={() => void update({ vim: !settings.vim })}>
      {settings.theme} {settings.vim ? "vim" : "plain"}
    </button>
  );
}

describe("SettingsProvider", () => {
  beforeEach(() => invokeMock.mockReset());

  it("keeps the defaults when settings can't be loaded", async () => {
    invokeMock.mockRejectedValueOnce("LOCALAPPDATA is not set");
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_settings"));
    expect(screen.getByRole("button")).toHaveTextContent("system plain");
  });

  it("loads stored settings and reloads them when the window gets focus", async () => {
    invokeMock.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, theme: "dark" });
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText("dark plain");
    invokeMock.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, theme: "light" });
    act(() => void window.dispatchEvent(new Event("focus")));
    await screen.findByText("light plain");
  });

  it("stores updates and shows the stored value", async () => {
    invokeMock.mockImplementation(async (command, args) =>
      command === "set_settings" ? (args as { settings: object }).settings : DEFAULT_SETTINGS,
    );
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText("system plain");
    act(() => screen.getByRole("button").click());
    await screen.findByText("system vim");
    expect(invokeMock).toHaveBeenCalledWith("set_settings", { settings: { ...DEFAULT_SETTINGS, vim: true } });
  });

  it("applies the theme and the editor font size to the page", async () => {
    invokeMock.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, theme: "dark", editorFontSize: 18 });
    const { unmount } = render(<SettingsProvider><Probe /></SettingsProvider>);
    await screen.findByText("dark plain");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("18px");
    unmount();
    invokeMock.mockResolvedValueOnce(DEFAULT_SETTINGS);
    render(<SettingsProvider><Probe /></SettingsProvider>);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeUndefined());
  });
});
