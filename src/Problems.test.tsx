import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Problems } from "./Problems";

describe("Problems", () => {
  it("links rows with a file and line, and jumps with click or Enter", async () => {
    const onJump = vi.fn();
    render(
      <Problems
        onJump={onJump}
        problems={[
          { severity: "error", file: "main.tex", line: 5, message: "Undefined control sequence." },
          { severity: "warning", file: null, line: null, message: "article.cls: Something" },
        ]}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByLabelText("Warning")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /main\.tex:5/ }));
    expect(onJump).toHaveBeenCalledWith("main.tex", 5);
    screen.getByRole("button").focus();
    await userEvent.keyboard("{Enter}");
    expect(onJump).toHaveBeenCalledTimes(2);
  });

  it("says when there are none", () => {
    render(<Problems problems={[]} onJump={vi.fn()} />);
    expect(screen.getByText("No problems")).toBeInTheDocument();
  });
});
