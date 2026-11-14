/** Templates for New project (spec 007 US3); each compiles unchanged (SC-006, Rust e2e test). */
import article from "./article.tex?raw";
import beamer from "./beamer.tex?raw";
import cv from "./cv.tex?raw";
import letter from "./letter.tex?raw";
import report from "./report.tex?raw";
import { STARTER_DOCUMENT } from "../starter";

export type Template = { id: string; name: string; description: string; text: string };

export const TEMPLATES: Template[] = [
  { id: "blank", name: "Blank", description: "A title and one section", text: STARTER_DOCUMENT },
  { id: "article", name: "Article", description: "Abstract, sections and an equation", text: article },
  { id: "report", name: "Report", description: "Chapters, contents and an appendix", text: report },
  { id: "letter", name: "Letter", description: "Addresses, opening and closing", text: letter },
  { id: "cv", name: "CV", description: "Education, experience and skills", text: cv },
  { id: "beamer", name: "Slides", description: "A Beamer presentation", text: beamer },
];
