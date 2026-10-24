/*
 * Maintenance mode (docs/OPERATIONS.md). Set MAINTENANCE_MODE=1 to stop serving
 * the application while data is restored or reconciled: pages show a plain
 * notice, the API answers 503, and nothing reads or writes votes. It is the
 * safe state whenever the completeness of acknowledged data is uncertain. It
 * never extends a deadline or reopens a vote; time keeps passing in the database.
 */
export function isMaintenanceMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.MAINTENANCE_MODE === "1";
}

export const MAINTENANCE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Civic Pulse is being maintained</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.5rem">Civic Pulse is being maintained</h1><p>Voting and results are temporarily unavailable while the service is checked. No votes have been lost and no deadline has been changed. Please try again later, or contact your RWA administrator.</p></body></html>`;
