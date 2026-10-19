import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "../lib/i18n";

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  /** Monospace line naming the target (e.g. the file name). */
  detail?: string;
  confirmLabel?: string;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return fn;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const { t } = useI18n();

  const confirm = useCallback<ConfirmFn>((opts) => {
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (options && dialog && !dialog.open) dialog.showModal();
  }, [options]);

  function settle(value: boolean) {
    resolverRef.current?.(value);
    resolverRef.current = null;
    dialogRef.current?.close();
    setOptions(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        onCancel={(e) => {
          e.preventDefault();
          settle(false);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) settle(false);
        }}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-line-strong bg-surface p-0 text-fg backdrop:bg-black/60"
      >
        {options && (
          <div className="p-6">
            <h2
              id="confirm-title"
              className="text-lg font-semibold tracking-tight"
            >
              {options.title}
            </h2>
            {options.detail && (
              <p className="mt-3 break-all rounded-sm border border-line bg-bg px-2.5 py-1.5 font-mono text-xs">
                {options.detail}
              </p>
            )}
            {options.description && (
              <div id="confirm-desc" className="mt-3 text-sm text-fg-soft">
                {options.description}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => settle(false)}
                className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className="rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                {options.confirmLabel ?? t("common.delete")}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </ConfirmContext.Provider>
  );
}
