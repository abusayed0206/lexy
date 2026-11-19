import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EngineMenu, reasonLabel } from "./EngineMenu";

describe("EngineMenu", () => {
  it("checks the current choice, shows the last compile and reports a new choice", async () => {
    const onChange = vi.fn();
    render(<EngineMenu choice="xelatex" lastCompile="Last compile: XeLaTeX (engine line)" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Engine" }));
    expect(screen.getByRole("menuitemradio", { name: "XeLaTeX" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Automatic" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Last compile: XeLaTeX (engine line)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemradio", { name: "LuaLaTeX" }));
    expect(onChange).toHaveBeenCalledWith("lualatex");
  });

  it("is disabled in read-only windows", () => {
    render(<EngineMenu choice="auto" lastCompile={null} disabled onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Engine" })).toBeDisabled();
  });

  it.each([
    ["marker", "engine line"],
    ["fontspec", "fontspec package"],
    ["default", "default"],
    ["Bangla text without a font setup; using Nirmala UI for this compile", "Bangla text"],
    [undefined, "default"],
  ])("labels the reason %j as %j", (reason, label) => {
    expect(reasonLabel(reason)).toBe(label);
  });
});
