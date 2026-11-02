// Dedicated noindex technical reference for error categories, IDs and triage.
import { Guide } from "@/components/guides/guide";
import { errorLoggingSections } from "@/components/guides/error-logging-content";
import { privateMetadata } from "@/shared/metadata";

export const metadata = privateMetadata(
  "Error Logging and IDs",
  "Understand Civic Pulse error categories, readable IDs, structured logs and safe triage.",
);

export default function ErrorLoggingGuidePage() {
  return (
    <Guide
      title="Error Logging and IDs"
      description="Identify an error safely, trace its request through logs and Sentry, and choose the right operator response."
      sections={errorLoggingSections}
      technical
    />
  );
}
