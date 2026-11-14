import { describe, expect, it } from "vitest";
import { appendEntry, bibliographySetup, firstEntry, insertCitation, rekey, uniqueKey } from "./citations";

const apply = (text: string, edit: { from: number; to: number; insert: string } | null) =>
  edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : text;

describe("uniqueKey", () => {
  const entry = { author: "Knuth, Donald E. and Someone Else", year: "1984", title: "The Literate Programming" };

  it("joins family name, year and the first significant title word", () => {
    expect(uniqueKey(entry, [])).toBe("knuth1984literate");
    expect(uniqueKey({ ...entry, author: "Kurt Gödel" }, [])).toBe("godel1984literate");
  });

  it("adds a letter when the key is taken", () => {
    expect(uniqueKey(entry, ["Knuth1984Literate", "knuth1984literatea"])).toBe("knuth1984literateb");
  });

  it("falls back to ref without an author", () => {
    expect(uniqueKey({ author: "", year: "", title: "" }, [])).toBe("ref");
  });
});

describe("rekey and firstEntry", () => {
  const fetched = " @article{Nature_2008, title={Black holes}, author={A. Person}, year={2008}}\n";

  it("replaces the key of the first entry", () => {
    expect(rekey(fetched, "person2008black")).toBe("@article{person2008black, title={Black holes}, author={A. Person}, year={2008}}");
    expect(rekey("<html>not bibtex</html>", "x")).toBeNull();
  });

  it("reads the fields for the review step", () => {
    expect(firstEntry(fetched)).toMatchObject({ key: "Nature_2008", title: "Black holes", author: "A. Person", year: "2008" });
  });
});

describe("insertCitation", () => {
  it("inserts \\cite at the cursor", () => {
    expect(apply("See .", insertCitation("See .", 4, ["a", "b"]))).toBe("See \\cite{a,b}.");
  });

  it("adds keys to the \\cite the cursor is in", () => {
    expect(apply("\\citep[p.~2]{a}", insertCitation("\\citep[p.~2]{a}", 14, ["b"]))).toBe("\\citep[p.~2]{a,b}");
    expect(apply("\\cite{}", insertCitation("\\cite{}", 6, ["b"]))).toBe("\\cite{b}");
  });
});

describe("bibliographySetup and appendEntry", () => {
  it("adds the bibliography commands before \\end{document} once", () => {
    const doc = "\\begin{document}\nText\n\\end{document}\n";
    const done = apply(doc, bibliographySetup(doc));
    expect(done).toBe("\\begin{document}\nText\n\\bibliographystyle{plain}\n\\bibliography{references}\n\n\\end{document}\n");
    expect(bibliographySetup(done)).toBeNull();
    expect(bibliographySetup("\\addbibresource{refs.bib}\\end{document}")).toBeNull();
  });

  it("appends an entry after a blank line", () => {
    expect(appendEntry("@book{a,}\n\n\n", "@book{b,}")).toBe("@book{a,}\n\n@book{b,}\n");
    expect(appendEntry("", "@book{b,}")).toBe("@book{b,}\n");
  });
});
