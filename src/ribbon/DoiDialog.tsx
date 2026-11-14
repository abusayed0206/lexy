import { useState } from "react";
import { Dialog } from "./Dialog";
import { firstEntry, rekey, uniqueKey } from "../latex/citations";
import { errorText } from "../projects";

type Props = {
  /** Project .bib files; empty → the entry goes into a new references.bib. */
  bibFiles: string[];
  existingKeys: string[];
  lookup: (doi: string) => Promise<string>;
  /** Add the (re-keyed) entry to `file` (null = create references.bib) and cite it. */
  onAdd: (entry: string, key: string, file: string | null) => void;
  onClose: () => void;
};

type Found = { bibtex: string; key: string; title: string; author: string; year: string };

/** Add by DOI (spec 007 US3): look the DOI up, show the entry for review, append it. Only the DOI is sent. */
export function DoiDialog({ bibFiles, existingKeys, lookup, onAdd, onClose }: Props) {
  const [doi, setDoi] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [file, setFile] = useState(bibFiles[0] ?? "");

  async function lookUp() {
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      const fetched = await lookup(doi);
      const entry = firstEntry(fetched);
      const key = uniqueKey({ author: entry?.author ?? "", year: entry?.year ?? "", title: entry?.title ?? "" }, existingKeys);
      const bibtex = rekey(fetched, key);
      if (!entry || !bibtex) throw new Error("Could not fetch this DOI: the answer wasn't BibTeX.");
      setFound({ bibtex, key, title: entry.title, author: entry.author, year: entry.year });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="Add by DOI"
      onClose={onClose}
      wide
      actions={
        <>
          <button type="button" className="primary" disabled={!found} onClick={() => found && onAdd(found.bibtex, found.key, bibFiles.length ? file : null)}>
            Add and cite
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <form
        className="doi-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (doi.trim() && !busy) void lookUp();
        }}
      >
        <label className="field">
          <span>DOI</span>
          <input
            autoFocus
            value={doi}
            placeholder="10.1038/nphys1170"
            aria-invalid={error !== null}
            aria-describedby="doi-note"
            onChange={(event) => setDoi(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy || !doi.trim()}>
          {busy ? "Looking up" : "Look up"}
        </button>
      </form>
      <p id="doi-note" className="field-note">
        Only the DOI is sent to doi.org.
      </p>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {found ? (
        <>
          <p>
            <strong>{found.title || "(no title)"}</strong>
            <br />
            {[found.author, found.year].filter(Boolean).join(" · ")} — key <code>{found.key}</code>
          </p>
          <pre className="doi-preview" aria-label="BibTeX entry">
            {found.bibtex}
          </pre>
          {bibFiles.length > 1 ? (
            <label className="field">
              <span>Add to</span>
              <select value={file} onChange={(event) => setFile(event.target.value)}>
                {bibFiles.map((path) => (
                  <option key={path}>{path}</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="field-note">{bibFiles.length ? `Adds to ${bibFiles[0]}.` : "Creates references.bib and adds the bibliography to the main document."}</p>
          )}
        </>
      ) : null}
    </Dialog>
  );
}
