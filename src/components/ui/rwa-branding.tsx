// Presentational RWA values (footer contact block and welcome message); both are plain text.
import {
  telephoneHref,
  type RwaBranding,
} from "@/shared/contracts/rwa-profile";

const linkClasses =
  "inline-flex min-h-12 items-center text-accent underline underline-offset-2";

/* Signed-in footer block. Every value is plain text; empty optional values are omitted. */
export function RwaContactBlock({
  branding,
}: Readonly<{
  branding: Pick<
    RwaBranding,
    "fullName" | "address" | "email" | "phone" | "website"
  >;
}>) {
  const phoneHref = branding.phone ? telephoneHref(branding.phone) : null;
  const hasLinks = Boolean(
    branding.email || branding.phone || branding.website,
  );
  return (
    <section
      aria-label="RWA contact details"
      className="mx-auto mb-4 grid max-w-content gap-1 text-caption text-muted"
    >
      <p className="font-semibold text-primary">{branding.fullName}</p>
      {branding.address ? (
        <address className="whitespace-pre-line not-italic">
          {branding.address}
        </address>
      ) : null}
      {hasLinks ? (
        <p className="flex flex-wrap items-center gap-x-4">
          {branding.email ? (
            <a href={`mailto:${branding.email}`} className={linkClasses}>
              {branding.email}
            </a>
          ) : null}
          {!branding.phone ? null : phoneHref ? (
            <a href={phoneHref} className={linkClasses}>
              {branding.phone}
            </a>
          ) : (
            <span>{branding.phone}</span>
          )}
          {branding.website ? (
            <a
              href={branding.website}
              className={linkClasses}
              target="_blank"
              rel="noopener noreferrer"
            >
              {branding.website}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/* Administrator-authored greeting; blank means nothing is shown. */
export function WelcomeMessage({ message }: Readonly<{ message: string }>) {
  if (message === "") {
    return null;
  }
  return (
    <section
      aria-label="Message from your RWA"
      className="rounded-card border border-border bg-surface p-4 text-body whitespace-pre-line"
    >
      {message}
    </section>
  );
}
