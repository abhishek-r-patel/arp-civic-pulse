// Partial identifier search with optional Settings-backed suggestions.
"use client";

import { useState } from "react";
import { TextField } from "@/components/ui/field";
import { ComboboxField } from "@/components/ui/combobox-field";
import { settingsListKey } from "@/shared/contracts/rwa-profile";

export function ResidentIdentifierFilter({
  id = "identifier",
  label,
  hideLabel = false,
  options,
  defaultValue,
}: Readonly<{
  id?: string;
  label: string;
  hideLabel?: boolean;
  options: readonly string[];
  defaultValue: string;
}>) {
  const [value, setValue] = useState(defaultValue);
  if (options.length) {
    return (
      <ComboboxField
        id={id}
        name="identifier"
        label={label}
        hideLabel={hideLabel}
        inline={false}
        showOptional={false}
        options={options}
        menuInFlow
        allowCustomValue
        maxLength={100}
        value={value}
        onChange={setValue}
        matchKey={settingsListKey}
      />
    );
  }
  return (
    <TextField
      id={id}
      name="identifier"
      label={label}
      hideLabel={hideLabel}
      inline={false}
      showOptional={false}
      defaultValue={defaultValue}
      placeholder="Contains..."
      maxLength={100}
      autoComplete="off"
      size={12}
    />
  );
}
