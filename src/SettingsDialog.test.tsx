import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsDialog } from "./SettingsDialog";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

function setup(change: Partial<Settings> = {}) {
  const update = vi.fn();
  const onClose = vi.fn();
  render(<SettingsDialog settings={{ ...DEFAULT_SETTINGS, ...change }} update={update} onClose={onClose} version="0.1.0" />);
  return { update, onClose };
}

describe("SettingsDialog", () => {
  it("groups settings in sections and applies a choice at once", () => {
    const { update } = setup();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Appearance", "Editing", "Preview", "Grammar", "Files", "About"]);
    fireEvent.change(screen.getByLabelText(/^Theme/), { target: { value: "dark" } });
    expect(update).toHaveBeenCalledWith({ theme: "dark" });
    fireEvent.click(screen.getByRole("switch", { name: /Vim keys/ }));
    expect(update).toHaveBeenCalledWith({ vim: true });
    fireEvent.click(screen.getByRole("switch", { name: /Grammar check/ }));
    expect(update).toHaveBeenCalledWith({ grammarCheck: true });
  });

  it("clamps numbers to their range and converts seconds", () => {
    const { update } = setup({ autoSave: true });
    const size = screen.getByLabelText(/Editor font size/);
    fireEvent.change(size, { target: { value: "99" } });
    fireEvent.blur(size);
    expect(update).toHaveBeenCalledWith({ editorFontSize: 24 });
    expect(size).toHaveValue(24);
    const delay = screen.getByLabelText(/Live preview delay/);
    fireEvent.change(delay, { target: { value: "2.5" } });
    fireEvent.keyDown(delay, { key: "Enter" });
    expect(update).toHaveBeenCalledWith({ livePreviewDelayMs: 2500 });
    const autoSave = screen.getByLabelText(/Auto-save after/);
    fireEvent.change(autoSave, { target: { value: "0" } });
    fireEvent.blur(autoSave);
    expect(update).toHaveBeenCalledWith({ autoSaveDelayMs: 1000 });
  });

  it("disables the auto-save delay while auto-save is off", () => {
    setup();
    expect(screen.getByLabelText(/Auto-save after/)).toBeDisabled();
  });

  it("refuses an invalid image folder or a non-https grammar server", () => {
    const { update } = setup();
    const folder = screen.getByLabelText(/Image folder/);
    fireEvent.change(folder, { target: { value: "a:b" } });
    fireEvent.blur(folder);
    expect(screen.getByRole("alert")).toHaveTextContent("Use a name without");
    fireEvent.change(folder, { target: { value: "images" } });
    fireEvent.blur(folder);
    expect(update).toHaveBeenCalledWith({ imageFolder: "images" });
    const server = screen.getByLabelText(/Server/);
    fireEvent.change(server, { target: { value: "http://lt.local" } });
    fireEvent.blur(server);
    expect(screen.getByRole("alert")).toHaveTextContent("Use an https:// address");
    expect(update).not.toHaveBeenCalledWith({ grammarServer: "http://lt.local" });
  });

  it("closes with Back or Escape and resets everything on request", () => {
    const { update, onClose } = setup({ vim: true });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Settings" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Reset all settings" }));
    expect(update).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    expect(screen.getByText(/Lexy 0\.1\.0/)).toBeInTheDocument();
  });
});
