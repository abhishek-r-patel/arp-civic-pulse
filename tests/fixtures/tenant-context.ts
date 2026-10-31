// Immutable synthetic tenant context shared by client-injected service tests.
import type { TenantContext } from "@/server/config/tenant-context";

export const testTenantContext: TenantContext = Object.freeze({
  tenantId: "single-rwa",
  kind: "single",
  hostname: "vote.example.test",
  canonicalOrigin: "https://vote.example.test",
  state: "active",
  projectUrl: "https://project.supabase.co",
  publishableKey: "synthetic-publishable-key",
  serviceRoleKeyRef: "SUPABASE_SERVICE_ROLE_KEY",
});
