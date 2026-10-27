// Native disabled fieldsets keep management controls visible without disabling navigation links.
import type { ReactNode } from "react";

export function ManagementFields({
  canManage,
  children,
}: Readonly<{ canManage: boolean; children: ReactNode }>) {
  return (
    <fieldset
      disabled={!canManage}
      aria-label="Management controls"
      className="min-w-0 border-0 p-0"
    >
      {children}
    </fieldset>
  );
}
