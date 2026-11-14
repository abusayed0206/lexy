import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DoiDialog } from "./DoiDialog";

const BIBTEX = "@article{Nature_2008, title={Black holes}, author={Ann Person and Bo Other}, year={2008}}";

function setup(lookup: (doi: string) => Promise<string>, bibFiles = ["refs.bib"]) {
  const onAdd = vi.fn();
  render(<DoiDialog bibFiles={bibFiles} existingKeys={["person2008black"]} lookup={lookup} onAdd={onAdd} onClose={vi.fn()} />);
  return { onAdd, field: screen.getByRole("textbox", { name: "DOI" }) };
}

describe("DoiDialog", () => {
  it("looks a DOI up, shows the entry with a unique key and adds it", async () => {
    const lookup = vi.fn(async () => BIBTEX);
    const { onAdd, field } = setup(lookup);
    expect(screen.getByText("Only the DOI is sent to doi.org.")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "10.1038/nphys1170" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("Black holes")).toBeInTheDocument();
    expect(lookup).toHaveBeenCalledWith("10.1038/nphys1170");
    expect(screen.getByLabelText("BibTeX entry")).toHaveTextContent("@article{person2008blacka,");
    fireEvent.click(screen.getByRole("button", { name: "Add and cite" }));
    expect(onAdd).toHaveBeenCalledWith(expect.stringContaining("@article{person2008blacka,"), "person2008blacka", "refs.bib");
  });

  it("shows lookup errors and adds nothing", async () => {
    const { onAdd, field } = setup(async () => Promise.reject("Could not fetch this DOI. Check your internet connection."));
    fireEvent.change(field, { target: { value: "10.1/x" } });
    fireEvent.submit(field.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not fetch this DOI");
    expect(screen.getByRole("button", { name: "Add and cite" })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("says a new references.bib is created when the project has none", async () => {
    const { onAdd, field } = setup(async () => BIBTEX, []);
    fireEvent.change(field, { target: { value: "10.1/x" } });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText(/Creates references.bib/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add and cite" }));
    expect(onAdd).toHaveBeenCalledWith(expect.any(String), "person2008blacka", null);
  });
});
