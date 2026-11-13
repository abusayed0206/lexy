import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listSystemFonts } from "../latex/fonts";
import { FontPicker } from "./FontPicker";

vi.mock("../latex/fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../latex/fonts")>()),
  listSystemFonts: vi.fn(),
}));

describe("FontPicker", () => {
  beforeEach(() => {
    vi.mocked(listSystemFonts).mockReset();
    vi.mocked(listSystemFonts).mockResolvedValue(["Arial", "Calibri", "Georgia"]);
  });

  const combo = () => screen.getByRole("combobox", { name: "Font" });

  it("shows the current font, or Default when Lexy has no settings block yet", () => {
    const { rerender } = render(<FontPicker value={{ kind: "builtin", id: "palatino" }} managed onChange={vi.fn()} />);
    expect(combo()).toHaveValue("Palatino");
    rerender(<FontPicker value={{ kind: "builtin", id: "latin-modern" }} managed={false} onChange={vi.fn()} />);
    expect(combo()).toHaveValue("Default");
  });

  it("does not ask for installed fonts until opened", async () => {
    const user = userEvent.setup();
    render(<FontPicker value={{ kind: "builtin", id: "latin-modern" }} managed onChange={vi.fn()} />);
    expect(listSystemFonts).not.toHaveBeenCalled();
    await user.click(combo());
    expect(listSystemFonts).toHaveBeenCalledTimes(1);
    expect(combo()).toHaveAttribute("aria-expanded", "true");
  });

  it("lists built-in fonts first, then installed fonts", async () => {
    const user = userEvent.setup();
    render(<FontPicker value={{ kind: "builtin", id: "latin-modern" }} managed onChange={vi.fn()} />);
    await user.click(combo());
    const builtin = screen.getByRole("group", { name: "Built-in fonts" });
    expect(within(builtin).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Latin Modern",
      "Times",
      "Palatino",
      "Helvetica",
      "Charter",
      "Linux Libertine",
    ]);
    const installed = screen.getByRole("group", { name: "Installed fonts" });
    await waitFor(() => expect(within(installed).getAllByRole("option")).toHaveLength(3));
  });

  it("filters as you type and picks with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FontPicker value={{ kind: "builtin", id: "latin-modern" }} managed onChange={onChange} />);
    await user.click(combo());
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(6));
    await user.type(combo(), "geo");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Georgia"]);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith({ kind: "system", family: "Georgia" });
    expect(combo()).toHaveAttribute("aria-expanded", "false");
  });

  it("picks a built-in font by click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FontPicker value={{ kind: "builtin", id: "latin-modern" }} managed onChange={onChange} />);
    await user.click(combo());
    await user.click(screen.getByRole("option", { name: "Times" }));
    expect(onChange).toHaveBeenCalledWith({ kind: "builtin", id: "times" });
  });

  it("moves the active option with arrow keys (aria-activedescendant)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FontPicker value={{ kind: "builtin", id: "latin-modern" }} managed onChange={onChange} />);
    await user.click(combo());
    await user.keyboard("{ArrowDown}{ArrowDown}");
    const active = document.getElementById(combo().getAttribute("aria-activedescendant")!);
    expect(active).toHaveTextContent("Palatino");
    expect(active).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onChange).toHaveBeenCalledWith({ kind: "builtin", id: "times" });
  });

  it("closes on Escape without changing anything", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FontPicker value={{ kind: "builtin", id: "times" }} managed onChange={onChange} />);
    await user.click(combo());
    await user.keyboard("{Escape}");
    expect(combo()).toHaveAttribute("aria-expanded", "false");
    expect(combo()).toHaveValue("Times");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still offers built-in fonts when installed fonts can't be listed", async () => {
    vi.mocked(listSystemFonts).mockRejectedValueOnce("fontdb failed");
    const user = userEvent.setup();
    render(<FontPicker value={{ kind: "builtin", id: "times" }} managed onChange={vi.fn()} />);
    await user.click(combo());
    expect(await screen.findByText("Could not list installed fonts")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Charter" })).toBeInTheDocument();
  });
});
