// Width-constrained, keyboard-accessible select menu for application dropdowns.
"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { controlClasses } from "./field-classes";

export type SelectMenuOption = Readonly<{
  value: string;
  label: string;
  disabled?: boolean;
}>;

type SelectMenuProps = Readonly<{
  id: string;
  options: readonly SelectMenuOption[];
  value?: string;
  defaultValue?: string;
  name?: string;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  required?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  buttonClassName?: string;
  fitContent?: boolean;
  menuInFlow?: boolean;
  onChange?: (value: string) => void;
}>;

export function SelectMenu({
  id,
  options,
  value,
  defaultValue,
  name,
  label,
  labelledBy,
  describedBy,
  required = false,
  disabled = false,
  invalid = false,
  className,
  buttonClassName,
  fitContent = false,
  menuInFlow = false,
  onChange,
}: SelectMenuProps) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<number, HTMLLIElement>());
  const typeahead = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? options[0]?.value ?? "",
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const selectedValue = value ?? uncontrolledValue;
  const selectedOption = options.find(
    (option) => option.value === selectedValue,
  );
  const availableIndexes = options.flatMap((option, index) =>
    option.disabled ? [] : [index],
  );

  useEffect(() => {
    if (open && active >= 0) {
      optionRefs.current.get(active)?.scrollIntoView({ block: "nearest" });
    }
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setOpen(false);
        setActive(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(
    () => () => {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    },
    [],
  );

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function choose(option: SelectMenuOption) {
    if (option.disabled) return;
    if (value === undefined) setUncontrolledValue(option.value);
    onChange?.(option.value);
    close();
  }

  function openAt(index: number) {
    setOpen(true);
    setActive(index);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const activePosition = availableIndexes.indexOf(active);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        const selectedIndex = options.findIndex(
          (option) => option.value === selectedValue && !option.disabled,
        );
        const selectedPosition = availableIndexes.indexOf(selectedIndex);
        const nextPosition =
          selectedPosition < 0
            ? direction > 0
              ? 0
              : availableIndexes.length - 1
            : (selectedPosition + direction + availableIndexes.length) %
              availableIndexes.length;
        openAt(availableIndexes[nextPosition] ?? -1);
        return;
      }
      const nextPosition =
        activePosition < 0
          ? direction > 0
            ? 0
            : availableIndexes.length - 1
          : (activePosition + direction + availableIndexes.length) %
            availableIndexes.length;
      setActive(availableIndexes[nextPosition] ?? -1);
    } else if (event.key === "Home" || event.key === "End") {
      if (open) {
        event.preventDefault();
        setActive(
          event.key === "Home"
            ? (availableIndexes[0] ?? -1)
            : (availableIndexes.at(-1) ?? -1),
        );
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        const selectedIndex = options.findIndex(
          (option) => option.value === selectedValue && !option.disabled,
        );
        openAt(
          selectedIndex >= 0 ? selectedIndex : (availableIndexes[0] ?? -1),
        );
      } else {
        const option = options[active];
        if (option) choose(option);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      close();
    } else if (
      open &&
      event.key.length === 1 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      typeahead.current += event.key.toLocaleLowerCase();
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      typeaheadTimer.current = setTimeout(() => {
        typeahead.current = "";
      }, 700);
      const start = Math.max(0, activePosition + 1);
      const orderedIndexes = [
        ...availableIndexes.slice(start),
        ...availableIndexes.slice(0, start),
      ];
      const match = orderedIndexes.find((index) =>
        options[index]?.label.toLocaleLowerCase().startsWith(typeahead.current),
      );
      if (match !== undefined) setActive(match);
    } else if (!open && event.key.length === 1) {
      event.preventDefault();
      openAt(availableIndexes[0] ?? -1);
      typeahead.current = event.key.toLocaleLowerCase();
      const match = availableIndexes.find((index) =>
        options[index]?.label.toLocaleLowerCase().startsWith(typeahead.current),
      );
      if (match !== undefined) setActive(match);
    }
  }

  return (
    <div
      ref={root}
      className={cn("relative min-w-0", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      {fitContent ? (
        <div
          aria-hidden="true"
          className="invisible h-0 overflow-hidden border-x px-3.5 pr-12 text-body whitespace-nowrap"
        >
          {options.map((option, index) => (
            <span key={index} className="block">
              {option.label}
            </span>
          ))}
        </div>
      ) : null}
      {name ? (
        <input
          type="hidden"
          name={name}
          value={selectedValue}
          disabled={disabled}
        />
      ) : null}
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && active >= 0 ? `${listId}-${active}` : undefined
        }
        disabled={disabled}
        className={cn(
          controlClasses,
          "flex min-w-0 items-center justify-between gap-3 text-left",
          invalid ? "border-error" : "border-control-border",
          buttonClassName,
        )}
        onClick={() => {
          if (open) close();
          else
            openAt(
              options.findIndex((option) => option.value === selectedValue),
            );
        }}
        onKeyDown={onKeyDown}
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedOption?.label ?? ""}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 text-muted"
        />
      </button>
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-hidden={!open}
        className={cn(
          "z-50 mt-1 max-h-72 w-full max-w-full min-w-0 overflow-y-auto rounded-card border border-border bg-surface p-1 text-primary shadow-panel",
          !menuInFlow && "absolute top-full right-0 left-0",
          !open && "hidden",
        )}
      >
        {options.map((option, index) => (
          <li
            key={`${option.value}-${index}`}
            ref={(element) => {
              if (element) optionRefs.current.set(index, element);
              else optionRefs.current.delete(index);
            }}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={option.value === selectedValue}
            aria-disabled={option.disabled || undefined}
            className={cn(
              "flex min-h-12 min-w-0 cursor-pointer items-center rounded-control px-3 py-2 text-body break-words",
              index === active ? "bg-primary/10" : "hover:bg-primary/5",
              option.disabled && "cursor-not-allowed opacity-50",
              option.value === selectedValue && "font-semibold",
            )}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => {
              if (!option.disabled) setActive(index);
            }}
            onClick={() => choose(option)}
          >
            <span className="min-w-0 break-words whitespace-normal">
              {option.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
