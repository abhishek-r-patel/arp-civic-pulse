"use client";

/*
 * Last-resort boundary for failures in the root layout. It replaces the whole
 * document, so it renders its own <html>/<body> with inline styles (global CSS
 * is not loaded here) and shows the same readable error ID as other pages.
 */
import { usePageErrorId } from "@/components/ui/page-error-id";

export default function GlobalError({
  error,
  reset,
}: Readonly<{ error: Error; reset: () => void }>) {
  const errorId = usePageErrorId(error, "root");

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "2rem 1rem",
          lineHeight: 1.5,
        }}
      >
        <title>Something went wrong</title>
        <main style={{ maxWidth: "36rem", margin: "0 auto" }}>
          <h1>Something went wrong</h1>
          <p>
            Nothing you entered has been changed. Try again, and contact the RWA
            administrators if the problem continues.
          </p>
          <p>
            Error ID:{" "}
            <strong style={{ fontFamily: "monospace", userSelect: "all" }}>
              {errorId}
            </strong>
            . Share this ID with your RWA administrator if the problem
            continues.
          </p>
          <button type="button" onClick={reset}>
            Try Again
          </button>
        </main>
      </body>
    </html>
  );
}
