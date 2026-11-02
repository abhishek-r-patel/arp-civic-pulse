// PDF is mandatory; an operator may enable CSV per RWA for completed results.
import { ApiError } from "@/server/http/errors";
import type { TenantContext } from "@/server/config/tenant-context";
import { canViewAdministration } from "@/shared/contracts/register";

export type ExportFormat = "csv" | "pdf";

export function availableExportFormats(
  tenant: Pick<TenantContext, "kind" | "tenantId">,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExportFormat[] {
  const key =
    tenant.kind === "single"
      ? "CSV_EXPORT_ENABLED"
      : tenant.tenantId
        ? `TENANT_${tenant.tenantId.replaceAll("-", "").toUpperCase()}_CSV_EXPORT_ENABLED`
        : undefined;
  const setting = key ? env[key]?.trim() : undefined;

  if (
    setting !== undefined &&
    setting !== "" &&
    setting !== "true" &&
    setting !== "false"
  ) {
    throw new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: {
        source:
          tenant.kind === "single" ? "deployment_config" : "tenant_config",
        code: "CSV_EXPORT_FLAG_INVALID",
      },
    });
  }

  return setting === "true" ? ["csv", "pdf"] : ["pdf"];
}

export function availableResultExportFormats(
  tenant: Pick<TenantContext, "kind" | "tenantId">,
  actor: { isAdmin: boolean; isReadonly?: boolean },
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExportFormat[] {
  return canViewAdministration(actor)
    ? availableExportFormats(tenant, env)
    : [];
}
