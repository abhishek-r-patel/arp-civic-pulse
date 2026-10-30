// Public resident guide uses the same configured terminology as live ballots and registration.
import { Guide } from "@/components/guides/guide";
import { residentSections } from "@/components/guides/resident-content";
import { loadHouseholdTerms } from "@/server/settings/rwa-profile";
import { publicMetadata } from "@/shared/metadata";

export const metadata = publicMetadata("/user-guide/resident");

export default async function ResidentGuidePage() {
  const terms = await loadHouseholdTerms();
  return (
    <Guide
      title="Resident Guide"
      description="From registration and approval to voting, live turnout and final results."
      sections={residentSections(terms)}
    />
  );
}
