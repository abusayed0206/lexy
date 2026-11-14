import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectSearch } from "./ProjectSearch";

const texts = () =>
  new Map([
    ["main.tex", "The intro.\nMore intro text"],
    ["ch.tex", "Nothing"],
  ]);

function setup(readOnly = false) {
  const onOpen = vi.fn();
  const onReplaceAll = vi.fn();
  render(<ProjectSearch getTexts={texts} readOnly={readOnly} version={0} onOpen={onOpen} onReplaceAll={onReplaceAll} />);
  return { onOpen, onReplaceAll, find: screen.getByRole("textbox", { name: "Find in project" }) };
}

describe("ProjectSearch", () => {
  it("lists matches by file and opens one", async () => {
    const { onOpen, find } = setup();
    expect(find).toHaveFocus();
    fireEvent.change(find, { target: { value: "intro" } });
    await screen.findByText("2 matches in 1 file");
    fireEvent.click(screen.getAllByRole("button", { name: /intro/ })[1]);
    expect(onOpen).toHaveBeenCalledWith("main.tex", 16, 21);
  });

  it("toggles options with buttons and Alt keys, and shows regex errors inline", async () => {
    const { find } = setup();
    fireEvent.keyDown(find, { key: "r", altKey: true });
    expect(screen.getByRole("button", { name: ".*" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(find, { target: { value: "(" } });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(find).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: "Aa" }));
    expect(screen.getByRole("button", { name: "Aa" })).toHaveAttribute("aria-pressed", "true");
  });

  it("replaces in every file with matches, and not in read-only windows", async () => {
    const { onReplaceAll, find } = setup();
    fireEvent.change(find, { target: { value: "intro" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "start" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Replace all" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    expect(onReplaceAll).toHaveBeenCalledWith("intro", { matchCase: false, wholeWord: false, regex: false }, "start", ["main.tex"]);
  });

  it("disables replacing in a read-only window", async () => {
    const { find } = setup(true);
    fireEvent.change(find, { target: { value: "intro" } });
    await screen.findByText("2 matches in 1 file");
    expect(screen.getByRole("button", { name: "Replace all" })).toBeDisabled();
  });
});
