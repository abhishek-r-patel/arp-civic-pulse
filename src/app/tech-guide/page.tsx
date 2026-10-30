// Intentionally unlisted public developer documentation; noindex is not access control.
import { Guide } from "@/components/guides/guide";
import { technicalSections } from "@/components/guides/technical-content";
import { privateMetadata } from "@/shared/metadata";

export const metadata = privateMetadata(
  "Technical Guide",
  "A junior developer's end-to-end map of Civic Pulse, its database, feature flows and safe debugging.",
);

export default function TechnicalGuidePage() {
  return (
    <Guide
      title="Technical Guide"
      description="Understand the application from route to database, then change and debug it safely."
      sections={technicalSections}
      technical
    />
  );
}
