import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, MARGIN_PRESETS } from "../latex/settings";
import { LayoutMenu } from "./LayoutMenu";

function setup(settings = DEFAULT_SETTINGS) {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<LayoutMenu settings={settings} onChange={onChange} />);
  return { onChange, user };
}

describe("LayoutMenu", () => {
  it("lists Word's margin presets with their values plus Custom", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Margins" }));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Normal"),
      expect.stringContaining("Narrow"),
      expect.stringContaining("Moderate"),
      expect.stringContaining("Wide"),
      "Custom margins…",
    ]);
    expect(items[3]).toHaveTextContent("Left 5.08 cm");
    expect(items[0]).toHaveAttribute("aria-checked", "true");
  });

  it("marks Custom when margins match no preset", async () => {
    const { user } = setup({ ...DEFAULT_SETTINGS, margins: { top: 1, bottom: 1, left: 1, right: 2 } });
    await user.click(screen.getByRole("button", { name: "Margins" }));
    expect(screen.getByRole("menuitemradio", { name: /Custom/ })).toHaveAttribute("aria-checked", "true");
  });

  it("supports the keyboard: ArrowDown opens, arrows move, Escape closes and refocuses", async () => {
    const { user, onChange } = setup();
    screen.getByRole("button", { name: "Margins" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: /Normal/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: /Narrow/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("menuitemradio", { name: /Custom/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Margins" })).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes when clicking outside", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Margins" }));
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("changes paper size and orientation", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button", { name: "Size" }));
    await user.click(screen.getByRole("menuitemradio", { name: /Letter/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, paper: "letter" });
    await user.click(screen.getByRole("button", { name: "Orientation" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Landscape" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, orientation: "landscape" });
  });

  describe("Custom margins dialog", () => {
    async function openCustom() {
      const ctx = setup({ ...DEFAULT_SETTINGS, margins: MARGIN_PRESETS.moderate });
      await ctx.user.click(screen.getByRole("button", { name: "Margins" }));
      await ctx.user.click(screen.getByRole("menuitemradio", { name: /Custom/ }));
      return ctx;
    }

    it("is a labelled modal prefilled with the current margins, focus in the first field", async () => {
      await openCustom();
      const dialog = screen.getByRole("dialog", { name: "Custom margins" });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(screen.getByLabelText("Top (cm)")).toHaveValue(2.54);
      expect(screen.getByLabelText("Left (cm)")).toHaveValue(1.91);
      expect(screen.getByLabelText("Top (cm)")).toHaveFocus();
    });

    it.each(["0.2", "7", ""])("rejects %j with an inline error and a disabled Apply", async (bad) => {
      const { user, onChange } = await openCustom();
      const left = screen.getByLabelText("Left (cm)");
      await user.clear(left);
      if (bad) await user.type(left, bad);
      expect(left).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByText("Between 0.5 and 6 cm")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("applies valid values", async () => {
      const { user, onChange } = await openCustom();
      const left = screen.getByLabelText("Left (cm)");
      await user.clear(left);
      await user.type(left, "3");
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, margins: { ...MARGIN_PRESETS.moderate, left: 3 } });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("Escape cancels", async () => {
      const { user, onChange } = await openCustom();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps Tab focus inside the dialog", async () => {
      const { user } = await openCustom();
      await user.tab({ shift: true });
      expect(screen.getByRole("button", { name: "Apply" })).toHaveFocus();
      await user.tab();
      expect(screen.getByLabelText("Top (cm)")).toHaveFocus();
    });
  });
});
