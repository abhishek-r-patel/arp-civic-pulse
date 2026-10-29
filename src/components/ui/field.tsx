// Theme-safe form controls with persistent labels, explicit errors and accessible touch targets.
import { CircleAlert, Info, Lock } from "lucide-react";
import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { Children, isValidElement, useId } from "react";
import { cn } from "./cn";
import { controlClasses } from "./field-classes";
import { SelectMenu, type SelectMenuOption } from "./select-menu";

/*
 * Form controls (docs/DESIGN_SYSTEM.md sections 06 and 11): a persistent visible
 * label and error associated programmatically, click-to-reveal help, 48px
 * targets, at least 16px text and non-colour error cues. Placeholders are
 * never the label.
 */
export function FieldInfo({
  label,
  id,
  children,
}: Readonly<{ label: string; id: string; children: ReactNode }>) {
  return (
    <details className="relative shrink-0">
      <summary
        aria-label={`Information about ${label}`}
        className="flex size-12 cursor-pointer list-none items-center justify-center rounded-control text-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden"
      >
        <Info aria-hidden="true" className="size-5" />
      </summary>
      <div
        id={id}
        className="absolute top-full left-0 z-30 mt-1 w-[min(24rem,calc(100vw_-_2rem))] rounded-card border border-accent/40 bg-surface p-4 text-body text-primary shadow-lg"
      >
        {children}
      </div>
    </details>
  );
}

type FieldChrome = Readonly<{
  label: string;
  hideLabel?: boolean;
  inline?: boolean;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Set false where a form marks only required fields (with *). */
  showOptional?: boolean;
}>;

export function Chrome({
  id,
  label,
  hideLabel = false,
  inline = false,
  hint,
  error,
  required,
  showOptional = true,
  children,
}: FieldChrome & Readonly<{ id: string; children: ReactNode }>) {
  const labelElement = (
    <label
      htmlFor={id}
      className={hideLabel ? "sr-only" : "text-body font-semibold text-primary"}
    >
      {label}
      {required ? (
        <>
          <span aria-hidden="true" className="text-error">
            {"\u00a0"}*
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : showOptional ? (
        <span className="font-normal text-muted"> (optional)</span>
      ) : null}
    </label>
  );

  const labelContent = hint ? (
    <div className="flex min-w-0 items-center justify-start gap-0.5">
      {labelElement}
      <FieldInfo label={label} id={`${id}-hint`}>
        <p className="whitespace-pre-line">{hint}</p>
      </FieldInfo>
    </div>
  ) : (
    labelElement
  );
  const errorElement = error ? (
    <p
      id={`${id}-error`}
      className="flex items-start gap-1.5 text-caption font-semibold text-error"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{error}</span>
    </p>
  ) : null;

  if (inline) {
    return (
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,0.5fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
        {labelContent}
        <div className="grid min-w-0 gap-2">
          {children}
          {errorElement}
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-2">
      {labelContent}
      {children}
      {errorElement}
    </div>
  );
}

export function describedBy(id: string, hint?: string, error?: string) {
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
      leading?: ReactNode;
      trailing?: ReactNode;
    }
>;

export function TextField({
  id,
  label,
  hideLabel,
  inline,
  hint,
  error,
  required = false,
  showOptional,
  className,
  ref,
  leading,
  trailing,
  ...rest
}: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const input = (
    <input
      ref={ref}
      id={fieldId}
      required={required}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(fieldId, hint, error)}
      className={cn(
        controlClasses,
        leading || trailing ? "min-w-0 flex-1" : undefined,
        error ? "border-error" : "border-control-border",
        className,
      )}
      {...rest}
    />
  );

  return (
    <Chrome
      id={fieldId}
      label={label}
      hideLabel={hideLabel}
      inline={inline ?? true}
      hint={hint}
      error={error}
      required={required}
      showOptional={showOptional}
    >
      {leading || trailing ? (
        <div className="flex min-w-0 items-center gap-2">
          {leading}
          {input}
          {trailing}
        </div>
      ) : (
        input
      )}
    </Chrome>
  );
}

type SelectOptionProps = Readonly<{
  value?: string | number;
  children?: ReactNode;
  disabled?: boolean;
}>;

function optionText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(optionText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return optionText(children.props.children);
  }
  return "";
}

function selectOptions(children: ReactNode): SelectMenuOption[] {
  const options: SelectMenuOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<SelectOptionProps>(child) || child.type !== "option") {
      return;
    }
    const label = optionText(child.props.children);
    const value = child.props.value ?? label;
    options.push({
      value: String(value),
      label: label || String(value),
      disabled: child.props.disabled,
    });
  });
  return options;
}

type SelectFieldProps = Readonly<
  FieldChrome & {
    fitContent?: boolean;
    menuInFlow?: boolean;
    id?: string;
    name?: string;
    value?: string;
    defaultValue?: string;
    disabled?: boolean;
    className?: string;
    onChange?: (value: string) => void;
    children?: ReactNode;
  }
>;

export function SelectField({
  fitContent,
  menuInFlow,
  id,
  label,
  hideLabel,
  inline,
  hint,
  error,
  required = false,
  showOptional,
  className,
  children,
  name,
  value,
  defaultValue,
  disabled,
  onChange,
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <Chrome
      id={fieldId}
      label={label}
      hideLabel={hideLabel}
      inline={inline ?? true}
      hint={hint}
      error={error}
      required={required}
      showOptional={showOptional}
    >
      <SelectMenu
        fitContent={fitContent}
        menuInFlow={menuInFlow}
        id={fieldId}
        name={name}
        label={label}
        options={selectOptions(children)}
        value={value}
        defaultValue={defaultValue}
        required={required}
        invalid={Boolean(error)}
        describedBy={describedBy(fieldId, hint, error)}
        disabled={disabled}
        buttonClassName={cn(className)}
        onChange={onChange}
      />
    </Chrome>
  );
}

type CheckboxFieldProps = Readonly<
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> & {
    id?: string;
    label: string;
    hint?: string;
    lockHint?: string;
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

// A native checkbox in a 48px row; keep optional help beside its label.
export function CheckboxField({
  id,
  label,
  hint,
  lockHint,
  className,
  ...rest
}: CheckboxFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <input
        id={fieldId}
        type="checkbox"
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className="size-6 shrink-0 accent-accent"
        {...rest}
      />
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        <label
          htmlFor={fieldId}
          className="flex min-h-12 min-w-0 items-center text-body font-semibold text-primary"
        >
          {label}
        </label>
        {hint ? (
          <FieldInfo label={label} id={`${fieldId}-hint`}>
            <p>{hint}</p>
          </FieldInfo>
        ) : null}
        {lockHint ? (
          <span
            role="img"
            aria-label={lockHint}
            tabIndex={0}
            title={lockHint}
            className="flex size-12 shrink-0 items-center justify-center rounded-control text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Lock aria-hidden="true" className="size-5" />
          </span>
        ) : null}
      </div>
    </div>
  );
}
