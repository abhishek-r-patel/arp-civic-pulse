// Themed calendar and wall-clock picker for deadlines entered in an RWA time zone.
"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "./button";
import { Chrome, describedBy } from "./field";
import { cn } from "./cn";
import { controlClasses } from "./field-classes";

type DateParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

type PickerDraft = Readonly<{
  selectedDate: string | null;
  year: number;
  month: number;
  hour: string;
  minute: string;
  second: string;
  meridiem: "AM" | "PM";
}>;

type DateTimePickerProps = Readonly<{
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string;
  value: string;
  timeZone: string;
  onChange: (value: string) => void;
}>;

const LOCAL_VALUE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;
const MONTHS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    utcDate(2026, index, 1),
  ),
);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function utcDate(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDateKey(
  value: string,
): Pick<DateParts, "year" | "month" | "day"> {
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return { year, month, day };
}

function parseLocalValue(value: string): DateParts | null {
  const match = LOCAL_VALUE.exec(value);
  if (!match) {
    return null;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] =
    match;
  const parts: DateParts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText ?? 0),
  };
  const check = utcDate(parts.year, parts.month - 1, parts.day);
  return check.getUTCFullYear() === parts.year &&
    check.getUTCMonth() === parts.month - 1 &&
    check.getUTCDate() === parts.day &&
    parts.hour <= 23 &&
    parts.minute <= 59 &&
    parts.second <= 59
    ? parts
    : null;
}

function todayInZone(
  timeZone: string,
): Pick<DateParts, "year" | "month" | "day"> {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function moveMonth(
  year: number,
  month: number,
  delta: number,
): Pick<DateParts, "year" | "month"> {
  const date = utcDate(year, month - 1 + delta, 1);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function moveDate(value: string, delta: number): string {
  const { year, month, day } = parseDateKey(value);
  const next = utcDate(year, month - 1, day + delta);
  return dateKey(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
  );
}

function dateLabel(value: string, options: Intl.DateTimeFormatOptions): string {
  const { year, month, day } = parseDateKey(value);
  return new Intl.DateTimeFormat("en", {
    ...options,
    timeZone: "UTC",
  }).format(utcDate(year, month - 1, day));
}

function displayValue(value: string): string {
  const parts = parseLocalValue(value);
  if (!parts) {
    return "";
  }
  const date = dateLabel(dateKey(parts.year, parts.month, parts.day), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const two = (number: number) => String(number).padStart(2, "0");
  const hour12 = parts.hour % 12 || 12;
  const meridiem = parts.hour < 12 ? "AM" : "PM";
  const time = `${two(hour12)}:${two(parts.minute)}:${two(parts.second)} ${meridiem}`;
  return `${date} · ${time}`;
}

function makeDraft(value: string, timeZone?: string): PickerDraft {
  const selected = parseLocalValue(value);
  const fallback =
    selected ??
    (timeZone
      ? todayInZone(timeZone)
      : {
          year: 1970,
          month: 1,
          day: 1,
        });
  return {
    selectedDate: selected
      ? dateKey(selected.year, selected.month, selected.day)
      : null,
    year: fallback.year,
    month: fallback.month,
    hour: String(selected ? selected.hour % 12 || 12 : 9).padStart(2, "0"),
    minute: String(selected?.minute ?? 0).padStart(2, "0"),
    second: String(selected?.second ?? 0).padStart(2, "0"),
    meridiem: selected && selected.hour >= 12 ? "PM" : "AM",
  };
}

function monthDays(year: number, month: number): (string | null)[][] {
  const firstWeekday = utcDate(year, month - 1, 1).getUTCDay();
  const count = utcDate(year, month, 0).getUTCDate();
  const cellCount = Math.ceil((firstWeekday + count) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= count ? dateKey(year, month, day) : null;
  });
  return Array.from({ length: cellCount / 7 }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );
}

function setTwoDigitValue(
  value: string,
  update: (value: string) => void,
): void {
  update(value.replace(/\D/gu, "").slice(0, 2));
}

export function DateTimePicker({
  id,
  name,
  label,
  hint,
  error,
  value,
  timeZone,
  onChange,
}: DateTimePickerProps) {
  const dialogId = useId();
  const dialogTitleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dayButtons = useRef(new Map<string, HTMLButtonElement>());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PickerDraft>(() => makeDraft(value));
  const [focusDate, setFocusDate] = useState("");
  const [todayKey, setTodayKey] = useState<string | null>(null);
  const [yearText, setYearText] = useState("");
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

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

  useEffect(() => {
    if (open && focusDate) {
      dayButtons.current.get(focusDate)?.focus();
    }
  }, [focusDate, open]);

  function openPicker() {
    const next = makeDraft(value, timeZone);
    const currentDate = todayInZone(timeZone);
    const focus =
      next.selectedDate ??
      dateKey(currentDate.year, currentDate.month, currentDate.day);
    setDraft(next);
    setTodayKey(dateKey(currentDate.year, currentDate.month, currentDate.day));
    setFocusDate(focus);
    setYearText(String(next.year));
    setShowMonthPicker(false);
    setPickerError(null);
    setOpen(true);
  }

  function changeMonth(delta: number) {
    const next = moveMonth(draft.year, draft.month, delta);
    setDraft((current) => ({ ...current, ...next }));
    setFocusDate(dateKey(next.year, next.month, 1));
  }

  function applyYearText(): number {
    const parsed = Number(yearText);
    if (!/^\d{4}$/u.test(yearText) || parsed < 1 || parsed > 9999) {
      return draft.year;
    }
    setDraft((current) => ({ ...current, year: parsed }));
    return parsed;
  }

  function selectDate(value: string) {
    setDraft((current) => ({
      ...current,
      selectedDate: value,
    }));
    setFocusDate(value);
    setPickerError(null);
  }

  function onDayKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    value: string,
  ) {
    let nextDate: string | null = null;
    if (event.key === "ArrowLeft") nextDate = moveDate(value, -1);
    if (event.key === "ArrowRight") nextDate = moveDate(value, 1);
    if (event.key === "ArrowUp") nextDate = moveDate(value, -7);
    if (event.key === "ArrowDown") nextDate = moveDate(value, 7);
    if (event.key === "Home" || event.key === "End") {
      const { year, month, day } = parseDateKey(value);
      const weekday = utcDate(year, month - 1, day).getUTCDay();
      nextDate = moveDate(value, event.key === "Home" ? -weekday : 6 - weekday);
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      const { year, month, day } = parseDateKey(value);
      const next = moveMonth(
        year,
        month,
        event.shiftKey
          ? event.key === "PageUp"
            ? -12
            : 12
          : event.key === "PageUp"
            ? -1
            : 1,
      );
      const lastDay = utcDate(next.year, next.month, 0).getUTCDate();
      nextDate = dateKey(next.year, next.month, Math.min(day, lastDay));
    }
    if (!nextDate) {
      return;
    }
    event.preventDefault();
    const next = parseDateKey(nextDate);
    setDraft((current) => ({
      ...current,
      year: next.year,
      month: next.month,
    }));
    setFocusDate(nextDate);
  }

  function apply() {
    if (!draft.selectedDate) {
      setPickerError("Choose a date to continue.");
      return;
    }
    const hour12 = Number(draft.hour);
    const minute = Number(draft.minute);
    const second = Number(draft.second);
    if (
      !/^\d{1,2}$/u.test(draft.hour) ||
      !/^\d{1,2}$/u.test(draft.minute) ||
      hour12 < 1 ||
      hour12 > 12 ||
      minute > 59 ||
      !/^\d{1,2}$/u.test(draft.second) ||
      second > 59
    ) {
      setPickerError("Enter a valid time using the 12-hour clock.");
      return;
    }
    const hour = (hour12 % 12) + (draft.meridiem === "PM" ? 12 : 0);
    const two = (number: number) => String(number).padStart(2, "0");
    const time = `${draft.selectedDate}T${two(hour)}:${two(minute)}:${two(second)}`;
    onChange(time);
    setOpen(false);
  }

  const weeks = monthDays(draft.year, draft.month);
  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(draft.year, draft.month - 1, 1));

  return (
    <Chrome
      id={id}
      label={label}
      hint={hint}
      error={error}
      inline
      showOptional={false}
    >
      <input type="hidden" name={name} value={value} />
      <button
        ref={trigger}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(
          controlClasses,
          "flex min-w-0 items-center justify-between gap-3 text-left",
          error ? "border-error" : "border-control-border",
        )}
        onClick={openPicker}
      >
        <span className={cn("min-w-0 flex-1", value ? "" : "text-muted")}>
          {displayValue(value) || "Select date and time"}
        </span>
        <CalendarDays
          aria-hidden="true"
          className="size-5 shrink-0 text-muted"
        />
      </button>
      <dialog
        ref={dialog}
        id={dialogId}
        aria-labelledby={dialogTitleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-card border border-border bg-surface p-0 text-primary shadow-xl backdrop:bg-primary/50 max-[400px]:w-full max-[400px]:max-w-none max-[400px]:rounded-none"
      >
        <div className="grid gap-4 p-4 max-[400px]:px-3 sm:p-6">
          <div className="grid gap-1">
            <h2
              id={dialogTitleId}
              className="font-heading text-section font-semibold"
            >
              Choose {label.toLowerCase()}
            </h2>
            <p className="text-caption text-muted">
              Times use the RWA time zone ({timeZone}).
            </p>
          </div>

          <section
            aria-label="Calendar"
            className="grid gap-3 max-[400px]:-mx-3"
          >
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="secondary"
                aria-label="Previous month"
                className="h-12 !w-12 shrink-0 !p-0 sm:!w-12"
                onClick={() => changeMonth(-1)}
              >
                <ChevronLeft aria-hidden="true" className="size-5 shrink-0" />
              </Button>
              <button
                type="button"
                aria-label={monthLabel}
                aria-expanded={showMonthPicker}
                className="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-control px-3 text-body font-semibold hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                onClick={() => {
                  setYearText(String(draft.year));
                  setShowMonthPicker((current) => !current);
                }}
              >
                <span>{monthLabel}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 transition-transform",
                    showMonthPicker && "rotate-180",
                  )}
                />
              </button>
              <Button
                variant="secondary"
                aria-label="Next month"
                className="h-12 !w-12 shrink-0 !p-0 sm:!w-12"
                onClick={() => changeMonth(1)}
              >
                <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
              </Button>
            </div>

            {showMonthPicker ? (
              <div className="grid gap-3 rounded-control border border-border p-3">
                <label className="grid gap-1 text-caption font-semibold">
                  Year
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="9999"
                    aria-label="Year"
                    className={cn(
                      controlClasses,
                      "h-12 min-h-12 border-control-border px-3 py-2",
                    )}
                    value={yearText}
                    onChange={(event) => {
                      const nextYear = event.target.value;
                      setYearText(nextYear);
                      if (/^\d{4}$/u.test(nextYear)) {
                        const parsed = Number(nextYear);
                        if (parsed >= 1 && parsed <= 9999) {
                          setDraft((current) => ({
                            ...current,
                            year: parsed,
                          }));
                          setFocusDate(dateKey(parsed, draft.month, 1));
                        }
                      }
                    }}
                    onBlur={applyYearText}
                  />
                </label>
                <div
                  role="group"
                  aria-label="Choose month"
                  className="grid grid-cols-3 gap-2"
                >
                  {MONTHS.map((month, index) => (
                    <button
                      key={month}
                      type="button"
                      aria-label={month}
                      aria-pressed={draft.month === index + 1}
                      className={cn(
                        "min-h-12 rounded-control border px-2 text-body font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        draft.month === index + 1
                          ? "border-accent bg-accent text-on-accent"
                          : "border-control-border bg-surface text-primary hover:bg-primary/5",
                      )}
                      onClick={() => {
                        const year = applyYearText();
                        setDraft((current) => ({
                          ...current,
                          year,
                          month: index + 1,
                        }));
                        setFocusDate(dateKey(year, index + 1, 1));
                        setShowMonthPicker(false);
                      }}
                    >
                      {month.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div
                role="grid"
                aria-label={`${monthLabel} calendar`}
                className="grid gap-1 max-[400px]:gap-0"
              >
                <div
                  role="row"
                  className="grid grid-cols-7 gap-1 max-[400px]:gap-0"
                >
                  {WEEKDAYS.map((day) => (
                    <div
                      key={day}
                      role="columnheader"
                      className="flex h-9 items-center justify-center text-caption font-semibold text-muted"
                    >
                      {day}
                    </div>
                  ))}
                </div>
                {weeks.map((week, weekIndex) => (
                  <div
                    key={`week-${weekIndex}`}
                    role="row"
                    className="grid grid-cols-7 gap-1 max-[400px]:gap-0"
                  >
                    {week.map((day, dayIndex) =>
                      day ? (
                        <div
                          key={day}
                          role="gridcell"
                          aria-selected={draft.selectedDate === day}
                          className="flex items-center justify-center"
                        >
                          <button
                            ref={(element) => {
                              if (element) dayButtons.current.set(day, element);
                              else dayButtons.current.delete(day);
                            }}
                            type="button"
                            aria-label={dateLabel(day, {
                              weekday: "long",
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })}
                            aria-pressed={draft.selectedDate === day}
                            aria-current={day === todayKey ? "date" : undefined}
                            tabIndex={day === focusDate ? 0 : -1}
                            className={cn(
                              "size-12 rounded-control text-body font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-[400px]:h-12 max-[400px]:w-full",
                              draft.selectedDate === day
                                ? "bg-accent text-on-accent hover:bg-accent-strong"
                                : "text-primary hover:bg-accent/10",
                              day === todayKey &&
                                draft.selectedDate !== day &&
                                "ring-1 ring-accent",
                            )}
                            onClick={() => selectDate(day)}
                            onKeyDown={(event) => onDayKeyDown(event, day)}
                          >
                            {parseDateKey(day).day}
                          </button>
                        </div>
                      ) : (
                        <div
                          key={`empty-${weekIndex}-${dayIndex}`}
                          role="gridcell"
                          aria-disabled="true"
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section
            aria-label="Time"
            className="grid gap-2 border-t border-border pt-4"
          >
            <h3 className="text-body font-semibold">Time</h3>
            <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] gap-2">
              {(
                [
                  ["Hour", "hour"],
                  ["Minute", "minute"],
                  ["Second", "second"],
                ] as const
              ).map(([part, key]) => (
                <label
                  key={key}
                  className="grid gap-1 text-caption font-semibold"
                >
                  {part}
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{1,2}"
                    maxLength={2}
                    aria-label={part}
                    className={cn(
                      controlClasses,
                      "h-12 min-h-12 border-control-border px-3 py-2 text-center tabular-nums",
                    )}
                    value={draft[key]}
                    onChange={(event) => {
                      setTwoDigitValue(event.target.value, (next) =>
                        setDraft((current) => ({
                          ...current,
                          [key]: next,
                        })),
                      );
                      setPickerError(null);
                    }}
                    onBlur={(event) => {
                      const current = event.currentTarget.value;
                      if (/^\d{1,2}$/u.test(current)) {
                        setDraft((state) => ({
                          ...state,
                          [key]: current.padStart(2, "0"),
                        }));
                      }
                    }}
                    title={
                      part === "Hour" ? "Hour, 01 to 12" : `${part}, 00 to 59`
                    }
                  />
                </label>
              ))}
              <div
                role="group"
                aria-label="AM or PM"
                className="grid grid-rows-2 gap-1 self-end"
              >
                {(["AM", "PM"] as const).map((meridiem) => (
                  <button
                    key={meridiem}
                    type="button"
                    aria-pressed={draft.meridiem === meridiem}
                    className={cn(
                      "min-h-12 min-w-12 rounded-control border px-2 text-body font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      draft.meridiem === meridiem
                        ? "border-accent bg-accent text-on-accent"
                        : "border-control-border bg-surface text-primary hover:bg-primary/5",
                    )}
                    onClick={() => {
                      setDraft((current) => ({ ...current, meridiem }));
                      setPickerError(null);
                    }}
                  >
                    {meridiem}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {pickerError ? (
            <p role="alert" className="text-caption font-semibold text-error">
              {pickerError}
            </p>
          ) : null}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {value ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            ) : null}
            <Button onClick={apply}>Apply</Button>
          </div>
        </div>
      </dialog>
    </Chrome>
  );
}
