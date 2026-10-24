import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

type ButtonVariant = "primary" | "secondary" | "destructive";

type ButtonProps = Readonly<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    loading?: boolean;
  }
>;

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent text-white hover:border-accent-strong hover:bg-accent-strong active:bg-accent-strong",
  secondary:
    "border-control-border bg-surface text-primary hover:bg-primary/5 active:bg-primary/10",
  destructive:
    "border-error bg-error text-white hover:border-error-strong hover:bg-error-strong active:bg-error-strong",
};

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
        "inline-flex touch-target w-full items-center justify-center gap-2 rounded-control border px-4 py-3 text-body font-semibold transition-colors sm:w-auto",
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
