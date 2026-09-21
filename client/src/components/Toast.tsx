import { useEffect } from 'react';

export interface ToastData {
  /** bumps on every new error so the same message can pop up again */
  id: number;
  title: string;
  /** the offending equation, when there is one */
  equation?: string;
  detail: string;
}

/**
 * Server errors for a bad equation look like "1+2=4 — The two sides are not equal (3 ≠ 4)".
 * Split those so the popup can show the equation on its own line.
 */
export function describeError(error: string, id: number): ToastData {
  const cut = error.indexOf(' — ');
  if (cut > 0) return { id, title: 'Invalid equation', equation: error.slice(0, cut), detail: error.slice(cut + 3) };
  return { id, title: 'Can’t play that', detail: error };
}

export function Toast({ toast, onClose }: { toast: ToastData; onClose: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onClose, 5500);
    return () => clearTimeout(t);
  }, [toast.id, onClose]);

  return (
    <div className="toast-wrap" role="alert" aria-live="assertive">
      <button key={toast.id} className="toast" onClick={onClose} title="Dismiss">
        <span className="toast-icon" aria-hidden>!</span>
        <span className="toast-body">
          <b>{toast.title}</b>
          {toast.equation ? <code>{toast.equation}</code> : null}
          <span>{toast.detail}</span>
        </span>
        <span className="toast-x" aria-hidden>×</span>
      </button>
    </div>
  );
}
