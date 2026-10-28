// App Support Access toggle and status contracts (docs/API.md section 4.4).
import { z } from "zod";

export const appSupportAccessSchema = z.strictObject({ enabled: z.boolean() });
export type AppSupportAccessInput = z.output<typeof appSupportAccessSchema>;

export interface AppSupportStatus {
  /** APP_SUPPORT_EMAIL is set for this deployment. */
  configured: boolean;
  /** The configured support email, shown so the RWA knows who would gain access. */
  email: string | null;
  /** A read-only App Support account is currently enabled. */
  enabled: boolean;
}
