// Public RWA administrator procedures explain controls without exposing real management data.
import { Guide } from "@/components/guides/guide";
import { adminSections } from "@/components/guides/admin-content";
import { loadHouseholdTerms } from "@/server/settings/rwa-profile";
import { publicMetadata } from "@/shared/metadata";

export const metadata = publicMetadata("/user-guide/rwa-admin");

export default async function AdminGuidePage() {
  const terms = await loadHouseholdTerms();
  return (
    <Guide
      title="RWA Admin Guide"
      description="Set up your RWA, manage residents, run a vote and review its results end to end."
      sections={adminSections(terms)}
    />
  );
}
