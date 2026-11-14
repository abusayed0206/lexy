import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InfoBar } from "./InfoBar";

describe("InfoBar", () => {
  it("announces errors as alerts and other severities as status", () => {
    const { rerender } = render(<InfoBar severity="error">Project folder is missing.</InfoBar>);
    expect(screen.getByRole("alert")).toHaveTextContent("Project folder is missing.");
    rerender(<InfoBar severity="success">Saved</InfoBar>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("shows actions and a close button only when asked", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <InfoBar severity="warning" actions={<button type="button">Reload</button>}>
        main.tex changed on disk.
      </InfoBar>,
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    rerender(<InfoBar onClose={onClose}>Note</InfoBar>);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
