/*
 * Which download formats this deployment offers for a completed result. CSV is
 * always available. PDF is included in version 1 but can be switched off per
 * deployment (PDF_EXPORT_ENABLED=0) if the host cannot run the renderer; the
 * controls then disappear and the endpoint answers EXPORT_FORMAT_UNAVAILABLE.
 */
export type ExportFormat = "csv" | "pdf";

export function availableExportFormats(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExportFormat[] {
  return env.PDF_EXPORT_ENABLED === "0" ? ["csv"] : ["csv", "pdf"];
}
