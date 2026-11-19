import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecoveryDialog } from "./RecoveryDialog";
import type { RecoveryCopy } from "./projects";

const copy = (path: string, extra: Partial<RecoveryCopy> = {}): RecoveryCopy => ({
  path,
  text: "x",
  savedAt: Date.now() - 60_000,
  baseHash: "",
  diskChanged: false,
  missing: false,
  ...extra,
});

describe("RecoveryDialog", () => {
  it("lists each file with its state and restores or discards one", async () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    const onClose = vi.fn();
    render(
      <RecoveryDialog
        copies={[copy("main.tex"), copy("chapters/intro.tex", { diskChanged: true }), copy("old.tex", { missing: true })]}
        onRestore={onRestore}
        onDiscard={onDiscard}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Unsaved text from your last session" })).toBeTruthy();
    expect(screen.getByText(/changed on disk since/)).toBeTruthy();
    expect(screen.getByText(/file no longer exists/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Restore main.tex" }));
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ path: "main.tex" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard old.tex" }));
    expect(onDiscard).toHaveBeenCalledWith(expect.objectContaining({ path: "old.tex" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
