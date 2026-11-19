import { relativeDate } from "./ProjectHome";
import type { RecoveryCopy } from "./projects";
import { Dialog } from "./ribbon/Dialog";

type Props = {
  copies: RecoveryCopy[];
  onRestore: (copy: RecoveryCopy) => void;
  onDiscard: (copy: RecoveryCopy) => void;
  onClose: () => void;
};

/** Review unsaved text from the last session, file by file (spec 008 US1, contracts/ui.md). */
export function RecoveryDialog({ copies, onRestore, onDiscard, onClose }: Props) {
  return (
    <Dialog
      title="Unsaved text from your last session"
      onClose={onClose}
      wide
      actions={
        <button type="button" className="primary" onClick={onClose}>
          Done
        </button>
      }
    >
      {copies.length === 0 ? <p>Nothing left to recover.</p> : null}
      <ul className="recovery-list">
        {copies.map((copy) => (
          <li key={copy.path}>
            <div className="recovery-file">
              <strong>{copy.path}</strong>
              <span>
                saved {relativeDate(copy.savedAt)}
                {copy.missing ? " · file no longer exists" : copy.diskChanged ? " · changed on disk since" : ""}
              </span>
            </div>
            <button type="button" onClick={() => onRestore(copy)} aria-label={`Restore ${copy.path}`}>
              Restore
            </button>
            <button type="button" onClick={() => onDiscard(copy)} aria-label={`Discard ${copy.path}`}>
              Discard
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
