import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorTabs } from "./EditorTabs";

function setup(current = "a.tex") {
  const handlers = {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onMove: vi.fn(),
    onCloseOthers: vi.fn(),
    onCopyPath: vi.fn(),
    onReveal: vi.fn(),
  };
  render(<EditorTabs paths={["main.tex", "a.tex", "ch\\b.tex"]} current={current} main="main.tex" dirty={new Set(["a.tex"])} {...handlers} />);
  return handlers;
}

describe("EditorTabs", () => {
  it("shows one tab per file with the active one selected and unsaved dots", () => {
    setup();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["main.tex", "a.tex", "b.tex"]);
    expect(screen.getByRole("tab", { name: /a\.tex/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /a\.tex/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByRole("img", { name: "Unsaved changes" })).toHaveLength(1);
  });

  it("selects, closes and keeps the main document open", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("tab", { name: /b\.tex/ }));
    expect(handlers.onSelect).toHaveBeenCalledWith("ch\\b.tex");
    fireEvent.click(screen.getByRole("button", { name: "Close a.tex" }));
    expect(handlers.onClose).toHaveBeenCalledWith("a.tex");
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Close main.tex" })).toBeNull();
  });

  it("moves focus with arrows, selects with Enter and closes with Delete or middle-click", () => {
    const handlers = setup();
    const a = screen.getByRole("tab", { name: /a\.tex/ });
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: /b\.tex/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(handlers.onSelect).toHaveBeenCalledWith("ch\\b.tex");
    fireEvent.keyDown(a, { key: "Delete" });
    expect(handlers.onClose).toHaveBeenCalledWith("a.tex");
    fireEvent.keyDown(screen.getByRole("tab", { name: /main\.tex/ }), { key: "Delete" });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    fireEvent(screen.getByRole("tab", { name: /b\.tex/ }), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(handlers.onClose).toHaveBeenCalledWith("ch\\b.tex");
  });

  it("offers Close others, Copy path and Reveal from the context menu", () => {
    const handlers = setup();
    fireEvent.contextMenu(screen.getByRole("tab", { name: /b\.tex/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Close others" }));
    expect(handlers.onCloseOthers).toHaveBeenCalledWith("ch\\b.tex");
    fireEvent.contextMenu(screen.getByRole("tab", { name: /main\.tex/ }));
    expect(screen.getByRole("menuitem", { name: "Close" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy path" }));
    expect(handlers.onCopyPath).toHaveBeenCalledWith("main.tex");
  });

  it("reorders by dragging", () => {
    const handlers = setup();
    fireEvent.dragStart(screen.getByRole("tab", { name: /b\.tex/ }), { dataTransfer: { effectAllowed: "" } });
    fireEvent.drop(screen.getByRole("tab", { name: /main\.tex/ }));
    expect(handlers.onMove).toHaveBeenCalledWith("ch\\b.tex", 0);
  });
});
