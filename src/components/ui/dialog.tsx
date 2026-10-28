// Deliberate lifecycle/account confirmations with native focus containment and theme-safe surfaces.
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./cn";

/*
 * Confirmation dialog (docs/DESIGN_SYSTEM.md section 06): centred in the
 * viewport at every breakpoint, with scrolling for tall content. It uses the native
 * <dialog> in modal mode, which contains focus, makes the rest of the page
 * inert, closes on Esc and returns focus to the control that opened it.
 * Cancel comes first and takes initial focus, so a destructive confirmation is
 * never auto-focused. Dismissing never runs the action.
 */
type ConfirmDialogProps = Readonly<{
  open: boolean;
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}>;

export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        // Esc: let the parent decide, so state and the dialog never disagree.
        event.preventDefault();
        if (!busy) {
          onCancel();
        }
      }}
      className={cn(
        "fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-card border border-t-[3px] border-border border-t-accent bg-surface p-0 text-primary shadow-xl",
        "pb-[env(safe-area-inset-bottom)] backdrop:bg-primary/50",
        "max-h-[90dvh] overflow-y-auto",
      )}
    >
      <div className="grid gap-4 p-4 sm:p-6">
        <h2
          id="confirm-dialog-title"
          className="font-heading text-section font-semibold sm:text-section-lg"
        >
          {title}
        </h2>
        <div className="grid gap-3 text-body text-primary">{children}</div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
            autoFocus
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "primary"}
            onClick={onConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
