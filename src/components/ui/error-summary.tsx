"use client";

import { useEffect, useRef } from "react";
import { CircleAlert } from "lucide-react";
import type { ApiFailure } from "@/shared/http/api-client";
import { describeFailure } from "@/shared/http/messages";

/*
 * Form-level error summary. It takes focus when a failed submission produces
 * it, so keyboard and screen-reader users land on the outcome; it is not
 * repeated for every keystroke. Field-level messages stay beside their fields.
 */
export function ErrorSummary({
  failure,
  fieldLabels = {},
}: Readonly<{
  failure: ApiFailure | null;
  fieldLabels?: Readonly<Record<string, string>>;
}>) {
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure) {
      region.current?.focus();
    }
  }, [failure]);

  if (!failure) {
    return null;
  }

  return (
    <div
      ref={region}
      tabIndex={-1}
      role="alert"
      className="flex w-full gap-3 rounded-card border border-error/40 bg-error/10 p-4 focus:outline-2 focus:outline-offset-2 focus:outline-secondary"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-error"
      />
      <div className="grid min-w-0 gap-2">
        <p className="text-card-heading font-semibold text-error">
          {failure.fieldErrors.length > 0
            ? "Please fix the highlighted fields"
            : "This could not be completed"}
        </p>
        <p className="text-body text-primary">{describeFailure(failure)}</p>
        {failure.code === "AUTH_REQUIRED" ||
        failure.code === "SESSION_EXPIRED" ? (
          <p>
            <a
              href="/sign-in"
              className="font-semibold underline underline-offset-2"
            >
              Sign in again
            </a>
          </p>
        ) : null}
        {failure.fieldErrors.length > 0 ? (
          <ul className="list-disc pl-5 text-body text-primary">
            {failure.fieldErrors.map((error) => (
              <li key={`${error.field}-${error.code}`}>
                <a
                  href={`#${error.field}`}
                  className="font-semibold underline underline-offset-2"
                >
                  {fieldLabels[error.field] ?? error.field}
                </a>
                : {error.message}
              </li>
            ))}
          </ul>
        ) : null}
        {failure.requestId ? (
          <p className="text-caption text-muted">
            Support ID: {failure.requestId}
          </p>
        ) : null}
      </div>
    </div>
  );
}
