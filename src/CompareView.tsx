import { useMemo } from "react";
import { wordDiff } from "./latex/wordDiff";

type Props = {
  /** "the last commit · 14 Nov 2026" */
  against: string;
  file: string;
  before: string;
  after: string;
  onClose: () => void;
};

/** Read-only track-changes view (spec 007 US4): insertions highlighted, deletions struck through. */
export function CompareView({ against, file, before, after, onClose }: Props) {
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  const changes = parts.filter((part) => part.kind !== "same").length;
  return (
    <section className="compare-view" aria-label={`Comparison of ${file}`}>
      <header className="compare-header">
        <span>
          Comparing <strong>{file}</strong> with {against}
          {changes ? "" : " — no changes"}
        </span>
        <span className="compare-legend" aria-hidden="true">
          <ins>added</ins> <del>removed</del>
        </span>
        <button type="button" className="primary" onClick={onClose} autoFocus>
          Close comparison
        </button>
      </header>
      <pre className="compare-body" tabIndex={0}>
        {parts.map((part, index) =>
          part.kind === "same" ? (
            <span key={index}>{part.text}</span>
          ) : part.kind === "added" ? (
            <ins key={index}>{part.text}</ins>
          ) : (
            <del key={index}>{part.text}</del>
          ),
        )}
      </pre>
    </section>
  );
}
