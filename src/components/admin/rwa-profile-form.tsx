"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { RwaProfile } from "@/shared/contracts/rwa-profile";
import {
  RWA_ACCENT_PALETTES,
  RWA_ACCENT_PALETTE_LABELS,
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

/* Admin form for the RWA profile and household/identifier display wording. */
export function RwaProfileForm({
  csrfToken,
  initialProfile,
}: Readonly<{
  csrfToken: string | undefined;
  initialProfile: RwaProfile;
}>) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
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
    const result = await apiRequest<RwaProfile>("/api/admin/settings", {
      method: "PATCH",
      body: profile,
      csrfToken,
    });
    setPending(false);
    if (!result.ok) {
      setFailure(result);
      return;
    }
    setProfile(result.data);
    setSaved(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      // Previews the chosen accent on this form's own buttons and swatches.
      data-palette={profile.accentPalette}
      className="grid max-w-ballot gap-6"
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
        }}
      />
      <TextField
        id="fullName"
        name="fullName"
        label="RWA Full Name"
        hint="The official name shown on vote pages, results, exports, the Votes page and the footer. Changing it updates all of them, including existing votes."
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
        hint="A short name shown in the header as “Civic Pulse for <alias>” on every page, and with the full name on the sign-in page."
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
        hint="Shown to signed-in members in the footer, on the public privacy page and on PDF results. Leave blank to hide it."
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
        hint="Shown to signed-in members in the footer and on PDF results. Leave blank to hide it."
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
        hint="Shown to signed-in members in the footer and on PDF results. Leave blank to hide it."
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
        hint="Enter a complete http:// or https:// address. Shown in the signed-in footer when set; leave blank to hide it."
        showOptional={false}
        maxLength={200}
        autoComplete="url"
        value={profile.website}
        onChange={(event) => update("website", event.target.value)}
        error={fieldErrorFor(failure, "website")}
      />
      <fieldset className="grid gap-2">
        <legend className="text-body font-semibold">Accent Colour</legend>
        <p id="accentPalette-hint" className="text-caption text-muted">
          Used for links, buttons and highlights across the app. Every option
          meets accessible contrast requirements.
        </p>
        <div
          role="radiogroup"
          aria-describedby="accentPalette-hint"
          className="grid gap-2 sm:grid-cols-2"
        >
          {RWA_ACCENT_PALETTES.map((palette) => (
            <label
              key={palette}
              htmlFor={`accentPalette-${palette}`}
              className="flex touch-target cursor-pointer items-center gap-3 rounded-card border border-control-border bg-surface px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent/5"
            >
              <input
                id={`accentPalette-${palette}`}
                type="radio"
                name="accentPalette"
                value={palette}
                checked={profile.accentPalette === palette}
                onChange={() => update("accentPalette", palette)}
                className="size-5 shrink-0 accent-accent"
              />
              <span
                data-palette={palette}
                aria-hidden="true"
                className="size-6 shrink-0 rounded-full bg-accent"
              />
              <span className="text-body">
                {RWA_ACCENT_PALETTE_LABELS[palette]}
              </span>
            </label>
          ))}
        </div>
        {fieldErrorFor(failure, "accentPalette") ? (
          <p className="text-caption text-error">
            {fieldErrorFor(failure, "accentPalette")}
          </p>
        ) : null}
      </fieldset>
      <TextAreaField
        id="welcomeMessage"
        name="welcomeMessage"
        label="Welcome Message"
        showOptional={false}
        hint={`Plain text, up to ${WELCOME_MESSAGE_MAX_LENGTH} characters. Shown on the Votes page and the administrator ${preview.Households} and Manage Votes pages. Leave blank to show nothing.`}
        maxLength={WELCOME_MESSAGE_MAX_LENGTH}
        value={profile.welcomeMessage}
        onChange={(event) => update("welcomeMessage", event.target.value)}
        error={fieldErrorFor(failure, "welcomeMessage")}
      />
      <TextField
        id="householdLabel"
        name="householdLabel"
        label="Household Label"
        hint="What one home is called, in the singular, such as Flat, Apartment or Villa. It replaces the word “household” across the app; the plural is worked out automatically."
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
      <fieldset className="grid gap-2">
        <legend className="text-body font-semibold">
          Identifier Label
          <span aria-hidden="true" className="text-error">
            {" "}
            *
          </span>
          <span className="sr-only"> (required)</span>
        </legend>
        <p id="identifierKind-hint" className="text-caption text-muted">
          How each {preview.household}’s identifier is named. This changes
          display wording only; saved identifiers and their matching rules stay
          the same.
        </p>
        <div
          role="radiogroup"
          aria-describedby="identifierKind-hint"
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
          <p className="text-caption text-error">
            {fieldErrorFor(failure, "identifierKind")}
          </p>
        ) : null}
      </fieldset>
      <p className="text-caption text-muted" aria-live="polite">
        Wording preview:{" "}
        <span className="font-semibold">
          {preview.Household} · {preview.Households} · {preview.identifierLabel}{" "}
          · {preview.identifierLabelPlural}
        </span>
      </p>
      {saved ? (
        <Notice tone="success" heading="RWA Settings Updated">
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
