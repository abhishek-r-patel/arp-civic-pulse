/*
 * Readable error IDs, shared by the server request wrapper and browser error
 * pages. Format: `<AREA>-<5 chars>-<5 chars>`, for example `AUTH-7K3QX-M2PTA`.
 *
 * - AREA names the product area that handled the request, so an operator can
 *   tell at a glance where to look (map: docs/OPERATIONS.md, "Debug a reported
 *   error ID"). It comes from the request path, never from user data.
 * - The suffix is 10 random Crockford base32 characters (50 bits). It avoids
 *   0/O and 1/I/L confusion when read over the phone. It encodes no identity,
 *   session, tenant secret, selection or time.
 *
 * Every API response carries this ID (body `requestId` and `X-Request-ID`), and
 * every log line and Sentry event for that request carries the same ID.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const ERROR_AREAS = [
  "AUTH",
  "VOTE",
  "EXPORT",
  "VOTEADMIN",
  "REGISTER",
  "SIGNUP",
  "SETTINGS",
  "AUDIT",
  "CONTACT",
  "HEALTH",
  "API",
  "PAGE",
  "BROWSER",
] as const;

export type ErrorArea = (typeof ERROR_AREAS)[number];

// First match wins, so more specific paths come before their parents.
const PATH_AREAS: ReadonlyArray<readonly [RegExp, ErrorArea]> = [
  [/^\/api\/auth(?:\/|$)/u, "AUTH"],
  [/^\/api\/votes\/[^/]+\/exports(?:\/|$)/u, "EXPORT"],
  [/^\/api\/votes(?:\/|$)/u, "VOTE"],
  [/^\/api\/admin\/votes(?:\/|$)/u, "VOTEADMIN"],
  [/^\/api\/admin\/(?:accounts|households)(?:\/|$)/u, "REGISTER"],
  [/^\/api\/admin\/settings(?:\/|$)/u, "SETTINGS"],
  [/^\/api\/admin\/audit(?:\/|$)/u, "AUDIT"],
  [/^\/api\/register(?:\/|$)/u, "SIGNUP"],
  [/^\/api\/contact(?:\/|$)/u, "CONTACT"],
  [/^\/api\/internal\/health(?:\/|$)/u, "HEALTH"],
];

export function areaForPath(pathname: string): ErrorArea {
  return PATH_AREAS.find(([pattern]) => pattern.test(pathname))?.[1] ?? "API";
}

function randomBlock(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // 256 is a multiple of 32, so masking keeps every character equally likely.
  return Array.from(bytes, (byte) => ALPHABET[byte & 31]).join("");
}

export function newErrorId(area: ErrorArea): string {
  return `${area}-${randomBlock(5)}-${randomBlock(5)}`;
}

const ERROR_ID_PATTERN = new RegExp(
  `^(?:${ERROR_AREAS.join("|")})-[${ALPHABET}]{5}-[${ALPHABET}]{5}$`,
  "u",
);

export function isErrorId(value: string): boolean {
  return ERROR_ID_PATTERN.test(value);
}
