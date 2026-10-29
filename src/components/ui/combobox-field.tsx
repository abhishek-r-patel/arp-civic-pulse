/* Accessible type-to-filter picker; custom search text is an explicit opt-in. */
"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { Chrome, describedBy } from "./field";
import { cn } from "./cn";
import { controlClasses } from "./field-classes";

// Long lists render only the first matches; typing narrows the rest.
const MAX_SHOWN = 100;

export function ComboboxField({
  id,
  name,
  label,
  hideLabel,
  hint,
  error,
  required = false,
  inline = true,
  showOptional,
  menuInFlow = false,
  allowCustomValue = false,
  maxLength,
  options,
  value,
  onChange,
  onTextChange,
  matchKey,
}: Readonly<{
  id: string;
  name: string;
  label: string;
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  required?: boolean;
  inline?: boolean;
  showOptional?: boolean;
  menuInFlow?: boolean;
  allowCustomValue?: boolean;
  maxLength?: number;
  options: readonly string[];
  /** Chosen option, or typed text when allowCustomValue is enabled. */
  value: string;
  onChange: (value: string) => void;
  /** Raw typed text, so an optional field can tell "left blank" from "typed but not chosen". */
  onTextChange?: (text: string) => void;
  /** Comparison key, so "a-101" finds "A-101". */
  matchKey: (value: string) => string;
}>) {
  const listId = useId();
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  const query = !allowCustomValue && text === value ? "" : matchKey(text);
  const matches = query
    ? options.filter((option) => matchKey(option).includes(query))
    : options;
  const shown = matches.slice(0, MAX_SHOWN);

  function choose(option: string) {
    setText(option);
    onTextChange?.(option);
    onChange(option);
    setOpen(false);
    setActive(-1);
  }

  // Strict pickers require an exact option; search filters may retain partial text.
  function settle() {
    setOpen(false);
    setActive(-1);
    const exact = options.find((option) => matchKey(option) === matchKey(text));
    if (exact) {
      setText(exact);
      onChange(exact);
    } else if (allowCustomValue) {
      onChange(text);
    } else if (text !== value) {
      onChange("");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(event.key === "ArrowDown" ? 0 : shown.length - 1);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) =>
        shown.length === 0
          ? -1
          : (current + step + shown.length) % shown.length,
      );
    } else if (event.key === "Enter" && open && shown[active]) {
      event.preventDefault();
      choose(shown[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  const status =
    matches.length === 0
      ? "No matches."
      : matches.length > shown.length
        ? `${matches.length} matches; showing the first ${shown.length}. Keep typing to narrow the list.`
        : `${matches.length} ${matches.length === 1 ? "match" : "matches"}.`;

  return (
    <Chrome
      id={id}
      label={label}
      hideLabel={hideLabel}
      inline={inline}
      showOptional={showOptional}
      hint={hint}
      error={error}
      required={required}
    >
      <div className="relative">
        <input type="hidden" name={name} value={value} />
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          maxLength={maxLength}
          spellCheck={false}
          required={required}
          aria-autocomplete="list"
          aria-expanded={open && shown.length > 0}
          aria-controls={listId}
          aria-activedescendant={
            open && active >= 0 ? `${listId}-${active}` : undefined
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(
            controlClasses,
            "pr-12",
            error ? "border-error" : "border-control-border",
          )}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onTextChange?.(event.target.value);
            setOpen(true);
            setActive(-1);
            if (allowCustomValue) onChange(event.target.value);
            else if (value) onChange("");
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={settle}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Show ${label} list`}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted"
          // Keeps focus in the input so blur does not close the list first.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((current) => !current);
            input.current?.focus();
          }}
        >
          <ChevronDown aria-hidden="true" className="size-5" />
        </button>
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          hidden={!open || shown.length === 0}
          className={cn(
            "z-50 mt-1 max-h-72 overflow-y-auto rounded-card border border-border bg-surface p-1 text-primary shadow-panel",
            !menuInFlow && "absolute top-full right-0 left-0",
          )}
        >
          {shown.map((option, index) => (
            <li
              key={option}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option === value}
              className={cn(
                "flex touch-target cursor-pointer items-center rounded-control px-3 text-body",
                index === active ? "bg-primary/10" : "hover:bg-primary/5",
                option === value && "font-semibold",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              {option}
            </li>
          ))}
        </ul>
        {open && shown.length === 0 ? (
          <p
            className={cn(
              "z-50 mt-1 rounded-card border border-border bg-surface px-3 py-2 text-caption text-muted shadow-panel",
              !menuInFlow && "absolute top-full right-0 left-0",
            )}
          >
            {allowCustomValue
              ? "No suggestions. You can still search this text."
              : "No matches."}
          </p>
        ) : null}
        <p role="status" className="sr-only">
          {open ? status : ""}
        </p>
      </div>
    </Chrome>
  );
}
