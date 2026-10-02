import { cx } from "./primitives";
import s from "./ui.module.css";

export interface Toast {
  id: number;
  kind: "ok" | "error" | "info";
  title: string;
  body?: string;
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className={s.toasts} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx(s.toast, t.kind === "ok" && s.toastOk, t.kind === "error" && s.toastError)}>
          <strong>{t.title}</strong>
          {t.body && <span>{t.body}</span>}
        </div>
      ))}
    </div>
  );
}
