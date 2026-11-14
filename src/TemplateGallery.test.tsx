import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NewProjectDialog, TemplateGallery, templateText } from "./TemplateGallery";
import { TEMPLATES } from "./templates";
import { STARTER_DOCUMENT } from "./starter";

describe("TemplateGallery", () => {
  it("lists every template with Blank selected first", () => {
    const onChange = vi.fn();
    render(<TemplateGallery value="blank" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.closest("label")!.querySelector(".template-name")!.textContent)).toEqual(["Blank", "Article", "Report", "Letter", "CV", "Slides"]);
    expect(radios[0]).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /Letter/ }));
    expect(onChange).toHaveBeenCalledWith("letter");
  });

  it("maps ids to template text, falling back to Blank", () => {
    expect(templateText("blank")).toBe(STARTER_DOCUMENT);
    expect(templateText("beamer")).toContain("\\documentclass{beamer}");
    expect(templateText("nope")).toBe(STARTER_DOCUMENT);
    for (const template of TEMPLATES) expect(template.text).toMatch(/\\documentclass/);
  });
});

describe("NewProjectDialog", () => {
  it("creates with the name and chosen template, and refuses invalid names", () => {
    const onCreate = vi.fn();
    render(<NewProjectDialog onCreate={onCreate} onClose={vi.fn()} />);
    const name = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.change(name, { target: { value: "a:b" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "Thesis" } });
    fireEvent.click(screen.getByRole("radio", { name: /Report/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onCreate).toHaveBeenCalledWith("Thesis", expect.objectContaining({ id: "report" }));
  });
});
