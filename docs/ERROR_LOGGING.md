# Error Logging and IDs

This reference explains the error information shown to users, the structured
records available to operators, and how to investigate a reported failure.
The runtime catalogue is defined in
[`src/server/http/errors.ts`](../src/server/http/errors.ts); the area-to-ID map
is defined in [`src/shared/observability/error-id.ts`](../src/shared/observability/error-id.ts).

## Error Response

An API error response has a stable uppercase `code`, safe `message`, optional
`fieldErrors`, optional allowlisted `context`, and `requestId`. The same request
ID is returned in `X-Request-ID` and attached to request logs and Sentry events.
Clients must treat IDs and codes as opaque values; do not infer a person's
identity or retry a mutation solely from an error response.

Expected failures are logged as `request.failed`; unexpected failures are
logged as `request.unhandled`. The request wrapper logs a known error's code,
category, type, status and level. System failures are normally reported to
Sentry; user errors are not. Planned or already-reported system errors can opt
out of Sentry reporting.

## Error IDs

An application ID has the form `AREA-XXXXX-XXXXX`, for example
`VOTE-7K3QX-M2PTA`. Its ten-character suffix is random Crockford base32; it
contains no identity, session, tenant secret, time or vote selection. Complete
IDs are generated per failure and cannot be enumerated. The area prefix points
to the relevant feature:

| Prefix | Area and starting point |
| --- | --- |
| `AUTH-` | Sign-in code, verification and sign-out; `src/server/auth/`, `src/app/api/auth/` |
| `VOTE-` | Resident vote lists/details, submissions, participation and results; `src/server/votes/`, `src/app/api/votes/` |
| `EXPORT-` | CSV/PDF result downloads; `src/server/exports/` |
| `VOTEADMIN-` | Admin vote drafts and lifecycle; `src/server/votes/`, `src/app/api/admin/votes/` |
| `REGISTER-` | Admin accounts, households and imports; `src/server/register/`, `src/app/api/admin/` |
| `SIGNUP-` | Public resident registration; `src/server/register/self-registration.ts` |
| `SETTINGS-` | RWA settings and App Support Access; `src/server/settings/` |
| `AUDIT-` | Audit history; `src/app/api/admin/audit/` |
| `CONTACT-` | Public contact form and email delivery; `src/server/contact.ts` |
| `DEMO-` | Demo persona sign-in; `src/server/demo/session.ts` |
| `HEALTH-` | Health probe; `src/app/api/internal/health/` |
| `API-` | Any other API route; `src/app/api/` |
| `PAGE-` | A page render crash; browser error boundary and Sentry `error_id`/`digest` tags |
| `BROWSER-` | Browser received a non-JSON API/platform response; Sentry `api.invalid_response` |

For a platform-generated failure, the browser may instead show a Vercel
`x-vercel-id` such as `iad1::…`. It is not an application error ID, but can be
searched in Vercel logs.

## Categories and Types

The category describes the failure; the type describes who should act. Log
levels are `info`, `warn` and `error`.

| Category | Meaning |
| --- | --- |
| `request` | Malformed, oversized or unsupported HTTP request. |
| `validation` | Submitted fields do not meet the request schema. |
| `authentication` | Sign-in is missing, expired or invalid. |
| `authorization` | The current account is not permitted to perform the action. |
| `security` | Browser request protection failed, such as Origin/CSRF validation. |
| `not_found` | The requested resource or optional format is unavailable. |
| `conflict` | The requested change conflicts with current state or a lifecycle rule. |
| `rate_limit` | The request budget is exhausted; honor `Retry-After`. |
| `dependency` | A required provider, configuration or provisioning step is unavailable. |
| `data_integrity` | Stored or projected results failed an integrity check; stop publication and investigate. |
| `internal` | An unexpected application or rendering fault. |

| Type | Logging and response |
| --- | --- |
| `user` | Expected outcome of the request. Logged at `info`, except `CSRF_FAILED` and `RATE_LIMITED`, which are `warn`. Not sent to Sentry. |
| `system` | Fault requiring operator attention. Logged at `error` and normally sent to Sentry. |

## API Error Catalogue

These are all current top-level API error codes. `fieldErrors[].code` values are
listed separately below; they are not top-level API codes.

| Code | HTTP | Category | Type | Meaning |
| --- | ---: | --- | --- | --- |
| `MALFORMED_JSON` | 400 | `request` | user | Request body is not valid JSON. |
| `AUTH_REQUIRED` | 401 | `authentication` | user | Sign in is required. |
| `SESSION_EXPIRED` | 401 | `authentication` | user | Sign-in session expired. |
| `FORBIDDEN` | 403 | `authorization` | user | Account lacks permission or is suspended. |
| `DEMO_EMAIL_DISABLED` | 403 | `authorization` | user | Email-sending action is disabled on the demo. |
| `CSRF_FAILED` | 403 | `security` | user | Browser request could not be verified. |
| `NOT_FOUND` | 404 | `not_found` | user | Resource is absent or inaccessible. |
| `EXPORT_FORMAT_UNAVAILABLE` | 404 | `not_found` | user | Requested download format is unavailable. |
| `METHOD_NOT_ALLOWED` | 405 | `request` | user | HTTP method is unsupported. |
| `ALREADY_SUBMITTED` | 409 | `conflict` | user | A response was already recorded. |
| `STALE_REVISION` | 409 | `conflict` | user | Draft changed; refresh and review it. |
| `REGISTER_CONFLICT` | 409 | `conflict` | user | Register change conflicts with current data. |
| `VOTE_FROZEN` | 409 | `conflict` | user | Active or finished vote cannot be edited. |
| `LIFECYCLE_CONFLICT` | 409 | `conflict` | user | Action is invalid for the vote's current state. |
| `VOTING_CLOSED` | 409 | `conflict` | user | Voting deadline passed or vote ended. |
| `RESULTS_UNAVAILABLE` | 409 | `conflict` | user | Results were requested before completion. |
| `ACTIVATION_BLOCKED` | 409 | `conflict` | user | Vote is missing activation requirements. |
| `REQUEST_TOO_LARGE` | 413 | `request` | user | Request exceeds the allowed size. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | `request` | user | Request content type is unsupported. |
| `VALIDATION_FAILED` | 422 | `validation` | user | One or more fields need correction. |
| `CODE_INVALID_OR_EXPIRED` | 422 | `authentication` | user | Sign-in code is invalid, used or expired. |
| `RATE_LIMITED` | 429 | `rate_limit` | user | Request budget is exhausted. |
| `INTERNAL_ERROR` | 500 | `internal` | system | Unexpected application fault. |
| `DEPENDENCY_UNAVAILABLE` | 503 | `dependency` | system | Required service is unavailable. |
| `AUTH_UNAVAILABLE` | 503 | `dependency` | system | Supabase Auth, rate limiter or trusted-proxy data is unavailable. |
| `PROVISIONING_INCOMPLETE` | 503 | `dependency` | system | Auth and register state may be partially updated; review before retrying. |
| `EXPORT_FAILED` | 503 | `internal` | system | CSV/PDF could not be generated. |
| `RESULTS_INTEGRITY_ERROR` | 503 | `data_integrity` | system | Results failed an integrity check; do not edit totals or publish them. |

Validation `fieldErrors[].code` values are `INVALID_TYPE`, `INVALID_FORMAT`,
`INVALID_VALUE`, `INVALID_SHAPE`, `TOO_SMALL`, `TOO_BIG`, `UNKNOWN_FIELD` and
`INVALID`. Field paths may identify a field or array index; submitted values
are never included.

## Investigate an ID

1. Ask for the complete error ID, approximate time and screen/route. Do not ask
   for sign-in codes, tokens, cookies, resident data or vote selections.
2. In Vercel project Logs, search the exact ID. All log lines for the request
   share `requestId`; start with `request.failed` or `request.unhandled`, then
   inspect earlier component events with the same ID.
3. Read `errorCode`, `errorCategory`, `errorType`, `hint`, safe cause fields,
   route, method, host, tenant and duration. `causeSource`, `causeCode` and
   `causeStatus` identify a dependency without copying its provider message.
4. For a `system` error, search Sentry Issues for `error_id:<ID>`. Use the
   `error_code` and route grouping, tags and source-mapped stack to locate the
   fault. For `PAGE-` errors, the `digest` tag links a server-render failure to
   its server log.
5. Follow the category-specific action in
   [Operations: Debug a reported error ID](./OPERATIONS.md#debug-a-reported-error-id).
   For `data_integrity`, stop and follow the incident procedure. Never repair
   results or blindly retry a mutation.

Logs and Sentry are restricted to allowlisted operational data. They must not
contain names, emails, phone numbers, OTPs, tokens, cookies, request bodies,
query strings, provider messages or ballot choices. An error ID does not
identify a person. Vercel log retention is plan-dependent, so search promptly.