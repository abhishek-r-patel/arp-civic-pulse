// Shared accessible buttons with contrast-safe foreground tokens in either appearance mode.
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "warning" | "destructive";

type ButtonProps = Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    loading?: boolean;
  }
>;

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent text-on-accent hover:border-accent-strong hover:bg-accent-strong active:bg-accent-strong",
  secondary:
    "border-control-border bg-surface text-primary hover:bg-primary/5 active:bg-primary/10",
  warning:
    "border-warning/40 bg-warning/5 text-warning hover:bg-warning/10 active:bg-warning/10",
  destructive:
    "border-error bg-error text-on-error hover:border-error-strong hover:bg-error-strong active:bg-error-strong",
};

const baseClasses =
  "inline-flex touch-target w-full items-center justify-center gap-2 rounded-control border px-4 py-3 text-body font-semibold transition-colors sm:w-auto";

// For a plain anchor that must behave like a button, e.g. a file download.
export function buttonClasses(
  variant: ButtonVariant = "primary",
  className?: string,
): string {
  return cn(baseClasses, variantClasses[variant], className);
}

// Navigation that looks like a button: a real link, not a button with a handler.
export function LinkButton({
  variant = "primary",
  className,
  disabled = false,
  ...rest
}: Readonly<
  ComponentProps<typeof Link> & { variant?: ButtonVariant; disabled?: boolean }
>) {
  if (disabled) {
    return (
      <span
        role="link"
        aria-disabled="true"
        title="Only administrators can make management changes."
        className={cn(
          baseClasses,
          variantClasses[variant],
          "cursor-not-allowed opacity-60",
          className,
        )}
      >
        {rest.children}
      </span>
    );
  }
  return (
    <Link
      className={cn(baseClasses, variantClasses[variant], className)}
      {...rest}
    />
  );
}

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // The label stays in place while loading so the accessible name is stable.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        baseClasses,
        "disabled:cursor-not-allowed disabled:opacity-60",
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
