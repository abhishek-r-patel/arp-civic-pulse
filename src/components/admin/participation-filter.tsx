// Participation "Show" filter that applies as soon as an option is chosen.
"use client";

import { useRouter } from "next/navigation";
import { SelectMenu } from "@/components/ui/select-menu";

export function ParticipationFilter({
  basePath,
  limit,
  value,
  households,
}: Readonly<{
  basePath: string;
  limit: number;
  value: string;
  households: string;
}>) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor="participation-submitted"
        className="text-body font-semibold whitespace-nowrap text-primary"
      >
        Show
      </label>
      <SelectMenu
        id="participation-submitted"
        name="submitted"
        label="Show"
        defaultValue={value}
        className="w-48"
        options={[
          { value: "", label: `All ${households}` },
          { value: "true", label: "Submitted" },
          { value: "false", label: "Not submitted" },
        ]}
        onChange={(next) => {
          const search = new URLSearchParams({ limit: String(limit) });
          if (next) search.set("submitted", next);
          router.push(`${basePath}?${search}`);
        }}
      />
    </div>
  );
}
