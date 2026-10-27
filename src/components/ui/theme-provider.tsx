/* Browser-local appearance provider; System is the default and no account data is persisted. */
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";
import { APPEARANCE_STORAGE_KEY } from "@/shared/theme";

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      enableColorScheme
      storageKey={APPEARANCE_STORAGE_KEY}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
