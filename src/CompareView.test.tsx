import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CompareView } from "./CompareView";

describe("CompareView", () => {
  it("shows insertions and deletions and closes", () => {
    const onClose = vi.fn();
    const { container } = render(<CompareView file="main.tex" against="the last commit" before="One two three." after="One 2 three, four." onClose={onClose} />);
    expect(screen.getByRole("region", { name: "Comparison of main.tex" })).toHaveTextContent("Comparing main.tex with the last commit");
    const body = container.querySelector(".compare-body")!;
    expect([...body.querySelectorAll("del")].map((d) => d.textContent)).toEqual(["two"]);
    expect([...body.querySelectorAll("ins")].map((i) => i.textContent)).toEqual(["2", ", four"]);
    fireEvent.click(screen.getByRole("button", { name: "Close comparison" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says when nothing changed", () => {
    render(<CompareView file="a.tex" against="x" before="same" after="same" onClose={vi.fn()} />);
    expect(screen.getByRole("region")).toHaveTextContent("no changes");
  });
});
