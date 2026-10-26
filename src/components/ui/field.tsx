import { CircleAlert } from "lucide-react";
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";
import { cn } from "./cn";

/*
 * Form controls (docs/DESIGN_SYSTEM.md sections 06 and 11): a persistent visible
 * label, hint and error associated programmatically, 48px targets, at least
 * 16px text, and non-colour error cues. Placeholders are never the label.
 */
const controlClasses =
  "touch-target w-full rounded-control border bg-surface px-3 py-2 text-body text-primary focus:border-accent disabled:cursor-not-allowed disabled:bg-primary/5 disabled:text-muted";

type FieldChrome = Readonly<{
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Set false where a form marks only required fields (with *). */
  showOptional?: boolean;
}>;

function Chrome({
  id,
  label,
  hint,
  error,
  required,
  showOptional = true,
  children,
}: FieldChrome & Readonly<{ id: string; children: ReactNode }>) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-body font-semibold text-primary">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="text-error">
              {" "}
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : showOptional ? (
          <span className="font-normal text-muted"> (optional)</span>
        ) : null}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          className="flex items-start gap-1.5 text-caption font-semibold text-error"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(
    Boolean,
  );
  return ids.length > 0 ? ids.join(" ") : undefined;
}

type TextFieldProps = Readonly<
  FieldChrome &
    Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "required"> & {
      id?: string;
      ref?: Ref<HTMLInputElement>;
    }
>;

export function TextField({
  id,
  label,
  hint,
  error,
  required = false,
  showOptional,
  className,
  ref,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <Chrome
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      showOptional={showOptional}
    >
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(
          controlClasses,
          error ? "border-error" : "border-control-border",
          className,
        )}
        {...rest}
      />
    </Chrome>
  );
}

type SelectFieldProps = Readonly<
  FieldChrome &
    Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "required"> & {
      id?: string;
    }
>;

export function SelectField({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  children,
  ...rest
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <Chrome
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      <select
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(
          controlClasses,
          error ? "border-error" : "border-control-border",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
    </Chrome>
  );
}

type CheckboxFieldProps = Readonly<
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> & {
    id?: string;
    label: string;
    hint?: string;
  }
>;

type TextAreaFieldProps = Readonly<
  FieldChrome &
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "required"> & {
      id?: string;
    }
>;

export function TextAreaField({
  id,
  label,
  hint,
  error,
  required = false,
  showOptional,
  className,
  ...rest
}: TextAreaFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <Chrome
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      showOptional={showOptional}
    >
      <textarea
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(
          controlClasses,
          "min-h-32 resize-y",
          error ? "border-error" : "border-control-border",
          className,
        )}
        {...rest}
      />
    </Chrome>
  );
}

// A native checkbox in a 48px row; the label text is the accessible name.
export function CheckboxField({
  id,
  label,
  hint,
  className,
  ...rest
}: CheckboxFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <input
        id={fieldId}
        type="checkbox"
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className="mt-1 size-6 shrink-0 accent-accent"
        {...rest}
      />
      <div className="grid gap-0.5">
        <label
          htmlFor={fieldId}
          className="flex touch-target items-center text-body font-semibold text-primary"
        >
          {label}
        </label>
        {hint ? (
          <p id={`${fieldId}-hint`} className="text-caption text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
