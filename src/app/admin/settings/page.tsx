// Administrator-controlled RWA identity, contact, display wording,
// administrator-only suggestion lists and read-only App Support Access.
import { AppSupportAccessControl } from "@/components/admin/app-support-access";
import { RwaProfileForm } from "@/components/admin/rwa-profile-form";
import { ManagementFields } from "@/components/admin/management-fields";
import { PageHeader } from "@/components/ui/layout";
import { adminRwaSettingsPageContext } from "@/server/register/page-context";
import { getAppSupportStatus } from "@/server/settings/app-support";
import { ChevronDown } from "lucide-react";

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
      <details className="group rounded-control border border-accent/30 bg-accent/5">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-control px-4 py-3 text-body font-semibold text-primary hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          <span>Where Each Value Appears</span>
          <ChevronDown
            aria-hidden="true"
            className="size-5 shrink-0 text-accent transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="grid gap-2 px-4 pb-4 text-body text-primary">
          <p>
            <span className="font-semibold">Alias:</span> the “Civic Pulse for
            …” header on every page and the sign-in page.
          </p>
          <p>
            <span className="font-semibold">Full name:</span> vote pages,
            results, exports, the Votes page, footer, sign-in page and privacy
            page.
          </p>
          <p>
            <span className="font-semibold">Address:</span> footer, privacy page
            and PDF results.
          </p>
          <p>
            <span className="font-semibold">Email, phone and website:</span>{" "}
            signed-in footer; email and phone also appear on PDF results.
          </p>
          <p>
            Blank optional values are not shown anywhere. Changes apply
            everywhere immediately, including existing votes and results.
          </p>
          <p>
            <span className="font-semibold">Household label:</span> replaces the
            word “household” on every page, in exports and in the menu.
          </p>
          <p>
            <span className="font-semibold">Identifier label:</span> names each
            household’s identifier, such as “Flat Number” or “Villa ID”.
          </p>
          <p>
            <span className="font-semibold">
              Default households and RWA positions:
            </span>{" "}
            suggestions for administrators only, when adding a household or an
            office in a PRIVATE vote.
          </p>
        </div>
      </details>
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
