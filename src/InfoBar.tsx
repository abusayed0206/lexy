import type { ReactNode } from "react";
import { Icon } from "./ribbon/icons";

export type InfoBarSeverity = "default" | "success" | "warning" | "error";

type Props = {
  severity?: InfoBarSeverity;
  /** The message; the icon is decorative, so the text must say what happened. */
  children: ReactNode;
  /** Buttons for the message, e.g. Reload / Keep mine. */
  actions?: ReactNode;
  /** Shown as a close button when set; leave unset while the state persists (e.g. a missing folder). */
  onClose?: () => void;
};

const ICON = { default: "info", success: "success", warning: "warning", error: "error" } as const;

/** Inline notice for app-state changes (Windows InfoBar guidance, DESIGN.md "Windows design alignment"). */
export function InfoBar({ severity = "default", children, actions, onClose }: Props) {
  return (
    <div className={`infobar infobar-${severity}`} role={severity === "error" ? "alert" : "status"}>
      <span className="infobar-icon">
        <Icon name={ICON[severity]} size={16} />
      </span>
      <span className="infobar-message">{children}</span>
      {actions ? <span className="infobar-actions">{actions}</span> : null}
      {onClose ? (
        <button type="button" className="infobar-close" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      ) : null}
    </div>
  );
}
