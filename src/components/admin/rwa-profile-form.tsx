// Administrator-only identity, contact and display settings with immediate scoped accent preview.
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { FieldInfo, TextAreaField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { RwaProfile } from "@/shared/contracts/rwa-profile";
import {
  DEFAULT_HOUSEHOLDS_MAX_ITEMS,
  DEFAULT_RWA_POSITIONS,
  formatSettingsList,
  parseSettingsList,
  RWA_ACCENT_PALETTES,
  RWA_ACCENT_PALETTE_LABELS,
  RWA_POSITIONS_MAX_ITEMS,
  WELCOME_MESSAGE_MAX_LENGTH,
} from "@/shared/contracts/rwa-profile";
import {
  buildHouseholdTerms,
  HOUSEHOLD_LABEL_MAX_LENGTH,
  HOUSEHOLD_LABEL_SUGGESTIONS,
  IDENTIFIER_KIND_LABELS,
  IDENTIFIER_KINDS,
} from "@/shared/contracts/household-terms";
import { apiRequest, type ApiFailure } from "@/shared/http/api-client";
import { fieldErrorFor } from "@/shared/http/messages";

// List errors may point at one entry ("rwaPositions[2]"); report them on the
// list field itself, naming the entry, so the summary links to the textarea.
function withListErrorsOnFields(
  failure: ApiFailure | null,
  lists: Readonly<Record<string, readonly string[]>>,
): ApiFailure | null {
  if (!failure) return null;
  return {
    ...failure,
    fieldErrors: failure.fieldErrors.map((error) => {
      const match = /^([^[]+)\[(\d+)\]$/u.exec(error.field);
      const field = match?.[1];
      const item =
        field === undefined ? undefined : lists[field]?.[Number(match?.[2])];
      return field !== undefined && item !== undefined
        ? { ...error, field, message: `“${item}”: ${error.message}` }
        : error;
    }),
  };
}

/*
 * Admin form for the RWA profile, household/identifier display wording and the
 * administrator-only default household and position suggestion lists.
 */
export function RwaProfileForm({
  csrfToken,
  initialProfile,
}: Readonly<{
  csrfToken: string | undefined;
  initialProfile: RwaProfile;
}>) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  // Lists are edited as comma-separated text and split only when saving.
  const [householdsText, setHouseholdsText] = useState(
    formatSettingsList(initialProfile.defaultHouseholds),
  );
  const [positionsText, setPositionsText] = useState(
    formatSettingsList(initialProfile.rwaPositions),
  );
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const preview = buildHouseholdTerms(
    profile.householdLabel,
    profile.identifierKind,
  );

  function update<K extends keyof RwaProfile>(key: K, value: RwaProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setSaved(false);
    setPending(true);
    const lists = {
      defaultHouseholds: parseSettingsList(householdsText),
      rwaPositions: parseSettingsList(positionsText),
    };
    const result = await apiRequest<RwaProfile>("/api/admin/settings", {
      method: "PATCH",
      body: { ...profile, ...lists },
      csrfToken,
    });
    setPending(false);
    if (!result.ok) {
      setFailure(withListErrorsOnFields(result, lists));
      return;
    }
    setProfile(result.data);
    setHouseholdsText(formatSettingsList(result.data.defaultHouseholds));
    setPositionsText(formatSettingsList(result.data.rwaPositions));
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      // Previews the chosen accent on this form's own buttons and swatches.
      data-palette={profile.accentPalette}
      className="grid max-w-ballot gap-6 form-panel"
    >
      <ErrorSummary
        failure={failure}
        fieldLabels={{
          fullName: "RWA Full Name",
          alias: "RWA Alias",
          address: "RWA Address",
          email: "RWA Email",
          phone: "RWA Phone",
          website: "RWA Website",
          accentPalette: "Accent Colour",
          welcomeMessage: "Welcome Message",
          householdLabel: "Household Label",
          identifierKind: "Identifier Label",
          defaultHouseholds: `Default ${preview.Households}`,
          rwaPositions: "RWA Positions",
        }}
      />
      <TextField
        id="fullName"
        name="fullName"
        label="RWA Full Name"
        inline
        hint="Your RWA’s official name, shown on vote pages, results, exports, Votes, footer, sign-in and privacy pages. Changes update existing votes and results."
        required
        maxLength={200}
        autoComplete="organization"
        value={profile.fullName}
        onChange={(event) => update("fullName", event.target.value)}
        error={fieldErrorFor(failure, "fullName")}
      />
      <TextField
        id="alias"
        name="alias"
        label="RWA Alias"
        inline
        hint="Header: “Civic Pulse for …” on every page; full name on sign-in."
        required
        maxLength={80}
        autoComplete="off"
        value={profile.alias}
        onChange={(event) => update("alias", event.target.value)}
        error={fieldErrorFor(failure, "alias")}
      />
      <TextAreaField
        id="address"
        name="address"
        label="RWA Address"
        hint="Appears in footer, privacy page and PDF results. Blank hides it."
        showOptional={false}
        maxLength={500}
        autoComplete="street-address"
        value={profile.address}
        onChange={(event) => update("address", event.target.value)}
        error={fieldErrorFor(failure, "address")}
      />
      <TextField
        id="email"
        name="email"
        type="email"
        label="RWA Email"
        inline
        hint="Appears in signed-in footer and PDF results. Blank hides it."
        showOptional={false}
        maxLength={254}
        autoComplete="email"
        value={profile.email}
        onChange={(event) => update("email", event.target.value)}
        error={fieldErrorFor(failure, "email")}
      />
      <TextField
        id="phone"
        name="phone"
        type="tel"
        label="RWA Phone"
        inline
        hint="Appears in signed-in footer and PDF results. Blank hides it."
        showOptional={false}
        maxLength={40}
        autoComplete="tel"
        value={profile.phone}
        onChange={(event) => update("phone", event.target.value)}
        error={fieldErrorFor(failure, "phone")}
      />
      <TextField
        id="website"
        name="website"
        type="url"
        label="RWA Website"
        inline
        hint="Full http:// or https:// address. Appears in signed-in footer; blank hides it."
        showOptional={false}
        maxLength={200}
        autoComplete="url"
        value={profile.website}
        onChange={(event) => update("website", event.target.value)}
        error={fieldErrorFor(failure, "website")}
      />
      <div
        role="group"
        aria-labelledby="accentPalette-label"
        className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)] sm:items-center sm:gap-4"
      >
        <div className="flex min-h-12 items-center justify-start gap-0.5 text-body font-semibold">
          <span id="accentPalette-label">Accent Colour</span>
          <FieldInfo label="Accent Colour" id="accentPalette-hint">
            <p>
              Sets link, button and highlight colours. Every option meets
              accessible contrast requirements.
            </p>
          </FieldInfo>
        </div>
        <div
          role="radiogroup"
          aria-labelledby="accentPalette-label"
          className="grid grid-cols-3 gap-2"
        >
          {RWA_ACCENT_PALETTES.map((palette) => (
            <label
              key={palette}
              htmlFor={`accentPalette-${palette}`}
              className="flex touch-target min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-card border border-control-border bg-surface px-1.5 py-2 text-center has-[:checked]:border-accent has-[:checked]:bg-accent/5"
            >
              <span className="flex items-center gap-1.5">
                <input
                  id={`accentPalette-${palette}`}
                  type="radio"
                  name="accentPalette"
                  value={palette}
                  checked={profile.accentPalette === palette}
                  onChange={() => update("accentPalette", palette)}
                  className="size-4 shrink-0 accent-accent"
                />
                <span
                  data-palette={palette}
                  aria-hidden="true"
                  className="size-5 shrink-0 rounded-full bg-accent"
                />
              </span>
              <span className="min-w-0 text-caption leading-tight">
                {RWA_ACCENT_PALETTE_LABELS[palette]}
              </span>
            </label>
          ))}
        </div>
        {fieldErrorFor(failure, "accentPalette") ? (
          <p className="text-caption text-error sm:col-span-2">
            {fieldErrorFor(failure, "accentPalette")}
          </p>
        ) : null}
      </div>
      <TextAreaField
        id="welcomeMessage"
        name="welcomeMessage"
        label="Welcome Message"
        showOptional={false}
        hint={`Plain text (max ${WELCOME_MESSAGE_MAX_LENGTH} characters). Appears only on the resident-facing Votes page, not administration screens; blank hides it.`}
        maxLength={WELCOME_MESSAGE_MAX_LENGTH}
        value={profile.welcomeMessage}
        onChange={(event) => update("welcomeMessage", event.target.value)}
        error={fieldErrorFor(failure, "welcomeMessage")}
      />
      <TextField
        id="householdLabel"
        name="householdLabel"
        label="Household Label"
        inline
        hint="Singular home label (e.g. Flat, Apartment or Villa); plural is automatic."
        required
        maxLength={HOUSEHOLD_LABEL_MAX_LENGTH}
        autoComplete="off"
        list="householdLabel-suggestions"
        value={profile.householdLabel}
        onChange={(event) => update("householdLabel", event.target.value)}
        error={fieldErrorFor(failure, "householdLabel")}
      />
      <datalist id="householdLabel-suggestions">
        {HOUSEHOLD_LABEL_SUGGESTIONS.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      <div
        role="group"
        aria-labelledby="identifierKind-label"
        className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,0.42fr)_minmax(0,1fr)] sm:items-center sm:gap-4"
      >
        <div className="flex min-h-12 items-center justify-start gap-0.5 text-body font-semibold">
          <span id="identifierKind-label">Identifier Label</span>
          <span aria-hidden="true" className="text-error">
            {" "}
            *
          </span>
          <span className="sr-only"> (required)</span>
          <FieldInfo label="Identifier Label" id="identifierKind-hint">
            <p>
              Names each {preview.household}’s identifier. Changes affect
              display wording, not saved values or matching.
            </p>
          </FieldInfo>
        </div>
        <div
          role="radiogroup"
          aria-labelledby="identifierKind-label"
          className="grid gap-2 sm:grid-cols-2"
        >
          {IDENTIFIER_KINDS.map((kind) => (
            <label
              key={kind}
              htmlFor={`identifierKind-${kind}`}
              className="flex touch-target cursor-pointer items-center gap-3 rounded-card border border-control-border bg-surface px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent/5"
            >
              <input
                id={`identifierKind-${kind}`}
                type="radio"
                name="identifierKind"
                value={kind}
                checked={profile.identifierKind === kind}
                onChange={() => update("identifierKind", kind)}
                className="size-5 shrink-0 accent-accent"
              />
              <span className="text-body">{IDENTIFIER_KIND_LABELS[kind]}</span>
            </label>
          ))}
        </div>
        {fieldErrorFor(failure, "identifierKind") ? (
          <p className="text-caption text-error sm:col-span-2">
            {fieldErrorFor(failure, "identifierKind")}
          </p>
        ) : null}
      </div>
      <p className="text-caption text-muted" aria-live="polite">
        Wording preview:{" "}
        <span className="font-semibold">
          {preview.Household} · {preview.Households} · {preview.identifierLabel}{" "}
          · {preview.identifierLabelPlural}
        </span>
      </p>
      <TextAreaField
        id="defaultHouseholds"
        name="defaultHouseholds"
        label={`Default ${preview.Households}`}
        showOptional={false}
        hint={`Comma-separated identifiers (e.g. H-101, H-102). Restricts admin ${preview.household} assignments and public registration. Max ${DEFAULT_HOUSEHOLDS_MAX_ITEMS} unique; blank allows typed values.`}
        autoComplete="off"
        value={householdsText}
        onChange={(event) => setHouseholdsText(event.target.value)}
        error={fieldErrorFor(failure, "defaultHouseholds")}
      />
      <TextAreaField
        id="rwaPositions"
        name="rwaPositions"
        label="RWA Positions"
        showOptional={false}
        hint={`Comma-separated office suggestions (e.g. ${formatSettingsList(DEFAULT_RWA_POSITIONS)}). Offered in PRIVATE votes; Add All Positions adds all. Max ${RWA_POSITIONS_MAX_ITEMS} unique; blank disables suggestions.`}
        autoComplete="off"
        value={positionsText}
        onChange={(event) => setPositionsText(event.target.value)}
        error={fieldErrorFor(failure, "rwaPositions")}
      />
      {saved ? (
        <Notice tone="success" heading="Settings Updated">
          The new details now appear across the app, including existing votes
          and results. Signed-in members and the public see only the parts
          described beside each field.
        </Notice>
      ) : null}
      <Button type="submit" loading={pending}>
        <Save aria-hidden="true" className="size-5" />
        Save Settings
      </Button>
    </form>
  );
}
