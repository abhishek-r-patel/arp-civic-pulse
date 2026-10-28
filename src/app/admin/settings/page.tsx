// Administrator-controlled RWA identity, contact, display wording,
// administrator-only suggestion lists and read-only App Support Access.
import { AppSupportAccessControl } from "@/components/admin/app-support-access";
import { RwaProfileForm } from "@/components/admin/rwa-profile-form";
import { ManagementFields } from "@/components/admin/management-fields";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/layout";
import { adminRwaSettingsPageContext } from "@/server/register/page-context";
import { getAppSupportStatus } from "@/server/settings/app-support";

export const metadata = {
  title: "RWA Settings",
  description: "Configure the RWA organization profile and display wording.",
  alternates: { canonical: "/admin/settings" },
};

export default async function RwaSettingsPage() {
  const deps = await adminRwaSettingsPageContext();
  const appSupport = await getAppSupportStatus(deps);

  return (
    <div className="grid gap-8">
      <PageHeader
        title="RWA Settings"
        description="Personalize how your RWA appears in Civic Pulse. Administrators can edit; committee observers have read-only access. Fields marked * are required; leave any other field blank to hide it everywhere."
      />
      <Notice tone="info" heading="Where Each Value Appears">
        Alias: the “Civic Pulse for …” header on every page and the sign-in
        page. Full name: vote pages, results, exports, the Votes page, footer
        and sign-in and privacy pages. Address: footer, privacy page and PDF
        results. Email, phone and website: signed-in footer (email and phone
        also on PDF results). Blank optional values are not shown anywhere.
        Changes apply everywhere immediately, including existing votes and
        results. Household label: replaces the word “household” on every page,
        in exports and in the menu. Identifier label: names each household’s
        identifier, such as “Flat Number” or “Villa ID”. Default households and
        RWA positions: suggestions for administrators only, when adding a
        household or an office in a PRIVATE vote.
      </Notice>
      <Notice tone="info" heading="Wording Only">
        Changing the household or identifier label changes display wording only.
        It does not rename saved identifiers, change saved values, or alter
        matching rules.
      </Notice>
      <ManagementFields canManage={deps.actor.isAdmin}>
        <RwaProfileForm
          csrfToken={deps.csrfToken}
          initialProfile={{
            fullName: deps.fullName,
            alias: deps.alias,
            address: deps.address,
            email: deps.email,
            phone: deps.phone,
            website: deps.website,
            accentPalette: deps.accentPalette,
            welcomeMessage: deps.welcomeMessage,
            householdLabel: deps.householdLabel,
            identifierKind: deps.identifierKind,
            defaultHouseholds: deps.defaultHouseholds,
            rwaPositions: deps.rwaPositions,
          }}
        />
        <AppSupportAccessControl
          csrfToken={deps.csrfToken}
          initialStatus={appSupport}
        />
      </ManagementFields>
    </div>
  );
}
