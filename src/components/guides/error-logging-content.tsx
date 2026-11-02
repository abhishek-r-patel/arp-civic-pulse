// Error logging guide content sourced from the runtime catalogue and ID areas.
import {
  errorDefinition,
  listErrorCodes,
  type ErrorCategory,
} from "@/server/http/errors";
import { ERROR_AREAS, type ErrorArea } from "@/shared/observability/error-id";
import { Note, Steps, type GuideSection } from "./guide";

const areaDetails: Record<ErrorArea, readonly [string, string]> = {
  AUTH: ["Sign-in code, verification and sign-out", "src/server/auth/"],
  VOTE: [
    "Resident votes, submissions, participation and results",
    "src/server/votes/",
  ],
  EXPORT: ["CSV/PDF result downloads", "src/server/exports/"],
  VOTEADMIN: [
    "Admin vote drafts and lifecycle",
    "src/server/votes/ and src/app/api/admin/votes/",
  ],
  REGISTER: [
    "Admin accounts, households and imports",
    "src/server/register/ and src/app/api/admin/",
  ],
  SIGNUP: [
    "Public resident registration",
    "src/server/register/self-registration.ts",
  ],
  SETTINGS: ["RWA settings and App Support Access", "src/server/settings/"],
  AUDIT: ["Audit history", "src/app/api/admin/audit/"],
  CONTACT: ["Public contact form and email delivery", "src/server/contact.ts"],
  DEMO: ["Demo persona sign-in", "src/server/demo/session.ts"],
  HEALTH: ["Health probe", "src/app/api/internal/health/"],
  API: ["Any other API route", "src/app/api/"],
  PAGE: [
    "Page render boundary; Sentry error_id/digest",
    "src/app/error.tsx and src/app/global-error.tsx",
  ],
  BROWSER: [
    "Non-JSON API/platform response",
    "src/shared/http/api-client.ts and Vercel logs",
  ],
};

const categoryDescriptions: Record<ErrorCategory, string> = {
  request: "Malformed, oversized or unsupported HTTP request.",
  validation: "Submitted fields do not meet the request schema.",
  authentication: "Sign-in is missing, expired or invalid.",
  authorization: "The current account is not permitted to perform the action.",
  security:
    "Browser request protection failed, such as Origin/CSRF validation.",
  not_found: "The resource or optional format is unavailable.",
  conflict:
    "The requested change conflicts with current state or lifecycle rules.",
  rate_limit: "The request budget is exhausted; honor Retry-After.",
  dependency:
    "A required provider, configuration or provisioning step is unavailable.",
  data_integrity: "Stored or projected results failed an integrity check.",
  internal: "An unexpected application or rendering fault.",
};

const errorRows = listErrorCodes().map((code) => ({
  code,
  ...errorDefinition(code),
}));

function ErrorCatalogue() {
  return (
    <div
      role="region"
      aria-label="API error catalogue table"
      tabIndex={0}
      className="min-w-0 overflow-x-auto rounded-control border border-border"
    >
      <table className="w-full min-w-[54rem] text-left text-caption">
        <caption className="sr-only">
          API error codes and their runtime definitions
        </caption>
        <thead className="bg-surface text-primary">
          <tr>
            {[
              "Code",
              "HTTP",
              "Category",
              "Type",
              "Log level",
              "Safe message",
            ].map((heading) => (
              <th key={heading} scope="col" className="p-3">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {errorRows.map((row) => (
            <tr key={row.code} className="border-t border-border">
              <th scope="row" className="p-3 align-top font-normal">
                <code className="break-all">{row.code}</code>
              </th>
              <td className="p-3 align-top">{row.status}</td>
              <td className="p-3 align-top">{row.category}</td>
              <td className="p-3 align-top">{row.type}</td>
              <td className="p-3 align-top">{row.level}</td>
              <td className="min-w-64 p-3 align-top">{row.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const errorLoggingSections: GuideSection[] = [
  {
    id: "error-ids",
    title: "1. Read the error ID",
    content: (
      <>
        <p>
          An API error has a stable machine-readable code and a per-failure
          request ID. The response includes the ID as <code>requestId</code> and
          the <code>X-Request-ID</code> header. The same ID joins the
          request&apos;s log lines and Sentry events.
        </p>
        <p>
          IDs look like <code>VOTE-7K3QX-M2PTA</code>. The area is useful for
          routing the investigation; the ten-character random Crockford base32
          suffix identifies only this occurrence. Complete IDs are generated at
          runtime and cannot be listed in advance.
        </p>
        <Note>
          Ask the reporter for the complete ID, approximate time and screen.
          Never ask for an OTP, token, cookie, resident record or vote choice.
          The ID does not encode who they are or what they selected.
        </Note>
        <p>
          <a className="text-accent underline" href="/tech-guide">
            Return to the Technical Guide
          </a>
        </p>
      </>
    ),
  },
  {
    id: "error-areas",
    title: "2. Find the product area",
    content: (
      <div
        role="region"
        aria-label="Error ID areas table"
        tabIndex={0}
        className="min-w-0 overflow-x-auto rounded-control border border-border"
      >
        <table className="w-full min-w-[42rem] text-left text-caption">
          <caption className="sr-only">
            Error ID prefixes, feature areas and source locations
          </caption>
          <thead className="bg-surface text-primary">
            <tr>
              <th scope="col" className="p-3">
                Prefix
              </th>
              <th scope="col" className="p-3">
                Area
              </th>
              <th scope="col" className="p-3">
                Starting point
              </th>
            </tr>
          </thead>
          <tbody>
            {ERROR_AREAS.map((area) => (
              <tr key={area} className="border-t border-border">
                <th scope="row" className="p-3 align-top font-normal">
                  <code>{area}-</code>
                </th>
                <td className="p-3 align-top">{areaDetails[area][0]}</td>
                <td className="min-w-64 p-3 align-top">
                  <code className="break-all">{areaDetails[area][1]}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: "error-categories",
    title: "3. Interpret category and type",
    content: (
      <>
        <p>
          <code>category</code> describes what kind of failure occurred;
          <code> type</code> tells the operator whether it needs investigation.
          Log levels are <code>info</code>, <code>warn</code> and{" "}
          <code>error</code>.
        </p>
        <dl className="grid gap-3 sm:grid-cols-2">
          {Object.entries(categoryDescriptions).map(
            ([category, description]) => (
              <div
                key={category}
                className="rounded-control border border-border bg-surface p-3"
              >
                <dt className="font-semibold text-primary">
                  <code>{category}</code>
                </dt>
                <dd>{description}</dd>
              </div>
            ),
          )}
        </dl>
        <ul className="grid list-disc gap-2 pl-6">
          <li>
            <code>user</code>: expected outcome, usually logged at info; CSRF
            and rate-limit errors are warnings. Not sent to Sentry.
          </li>
          <li>
            <code>system</code>: fault logged at error and normally sent to
            Sentry. Planned or already-reported faults may opt out.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "error-catalogue",
    title: "4. Look up an API error code",
    content: (
      <>
        <p>
          This table is rendered from the runtime catalogue in
          <code> src/server/http/errors.ts</code>, so it includes every current
          top-level API code and its exact category, type, status and safe
          response message.
        </p>
        <ErrorCatalogue />
        <p>
          Validation responses can also contain field-level codes:
          <code> INVALID_TYPE</code>, <code>INVALID_FORMAT</code>,
          <code> INVALID_VALUE</code>, <code>INVALID_SHAPE</code>,
          <code> TOO_SMALL</code>, <code>TOO_BIG</code>,
          <code> UNKNOWN_FIELD</code> and <code>INVALID</code>. Field paths
          identify fields or array indices only; values are not echoed.
        </p>
      </>
    ),
  },
  {
    id: "triage",
    title: "5. Trace and triage a failure",
    content: (
      <>
        <Steps>
          <li>
            Search the exact ID in Vercel project Logs. Begin with
            <code> request.failed</code> for a known error or
            <code> request.unhandled</code> for an unexpected failure.
          </li>
          <li>
            Inspect the error code/category/type, operator hint, safe cause
            fields, route, method, host, tenant and duration. Earlier dependency
            events use the same request ID.
          </li>
          <li>
            For a system error, search Sentry Issues for
            <code> error_id:&lt;ID&gt;</code>. Use the code/route grouping and
            source-mapped stack. For <code>PAGE-</code>, use the Sentry
            <code> digest</code> tag to find the server log.
          </li>
          <li>
            For dependency failures, check the named provider/configuration. For
            rate limits, investigate repeated bursts. For data-integrity errors
            or missing/incorrect votes, stop and follow the incident process;
            never edit totals or blindly retry.
          </li>
          <li>
            Verify the deployed host, project, version and migration state
            before concluding a local fix is live. Vercel runtime log retention
            is plan-dependent, so search promptly.
          </li>
        </Steps>
        <Note>
          A non-JSON response may instead show a <code>BROWSER-</code> ID or a
          Vercel <code>x-vercel-id</code>. The latter is a platform request ID,
          not an application error ID. Use the exact value when searching the
          corresponding logs.
        </Note>
        <p>
          The complete operational procedure is in
          <code> docs/OPERATIONS.md</code>, under{" "}
          <code>Debug a reported error ID</code>. The API contract is in{" "}
          <code>docs/API.md</code>, section 6.2.
        </p>
      </>
    ),
  },
  {
    id: "logging-privacy",
    title: "6. Logging and privacy boundaries",
    content: (
      <>
        <p>
          Logs and Sentry use allowlisted operational metadata and safe
          dependency identifiers, never raw provider messages. They must not
          include names, emails, phone numbers, OTPs, tokens, cookies, request
          bodies, query strings or ballot choices. A local scrubber test does
          not prove hosted observability is configured safely.
        </p>
        <p>
          The response may contain a safe message, stable code, field paths and
          allowlisted recovery context. The operator hint and dependency cause
          are for logs/Sentry only; they are not returned to the browser.
        </p>
      </>
    ),
  },
];
