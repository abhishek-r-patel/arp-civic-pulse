// Opt-in, manually emitted public page views only; never tracks authentication, ballots or form contents.
"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { CheckboxField } from "@/components/ui/field";

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...arguments_: unknown[]) => void;
  }
}

const CONSENT_KEY = "civic-pulse:public-analytics";
const CONSENT_EVENT = "civic-pulse:analytics-consent";

function consentSnapshot() {
  try {
    return localStorage.getItem(CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CONSENT_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CONSENT_EVENT, listener);
  };
}

export function PublicAnalytics({
  measurementId,
}: Readonly<{ measurementId?: string }>) {
  const pathname = usePathname();
  const consent = useSyncExternalStore(subscribe, consentSnapshot, () => false);
  const allowedPage = pathname === "/privacy" || pathname === "/contact";
  const enabled = Boolean(measurementId && allowedPage && consent);
  const lastPage = useRef<string | null>(null);

  function sendPageView() {
    if (!measurementId || !allowedPage || !consentSnapshot()) return;
    const key = `${measurementId}:${pathname}`;
    if (lastPage.current === key) return;
    const dataLayer = (window.dataLayer ??= []);
    window.gtag ??= (...arguments_: unknown[]) => {
      dataLayer.push(arguments_);
    };
    Reflect.set(window, `ga-disable-${measurementId}`, false);
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_domain: "none",
      page_location: `${window.location.origin}${pathname}`,
      page_title:
        pathname === "/privacy"
          ? "Privacy policy | Civic Pulse"
          : "Contact | Civic Pulse",
      page_referrer: "",
    });
    window.gtag("event", "page_view", {
      page_location: `${window.location.origin}${pathname}`,
      page_path: pathname,
      page_title:
        pathname === "/privacy"
          ? "Privacy policy | Civic Pulse"
          : "Contact | Civic Pulse",
      page_referrer: "",
    });
    lastPage.current = key;
  }

  useEffect(() => {
    if (!measurementId) return;
    Reflect.set(window, `ga-disable-${measurementId}`, !enabled);
    if (!enabled) lastPage.current = null;
    if (!consent) {
      for (const cookie of document.cookie.split(";")) {
        const name = cookie.split("=")[0]?.trim();
        if (name === "_ga" || name?.startsWith("_ga_"))
          document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      }
    }
  }, [measurementId, enabled, consent]);

  useEffect(() => {
    if (enabled && window.gtag) sendPageView();
  });

  if (!measurementId || !allowedPage) return null;

  return (
    <div className="mx-auto mt-4 max-w-content border-t border-border pt-4 text-caption text-muted">
      <CheckboxField
        label="Allow optional Google Analytics on privacy and contact pages"
        checked={consent}
        onChange={(event) => {
          try {
            localStorage.setItem(
              CONSENT_KEY,
              event.target.checked ? "granted" : "denied",
            );
          } catch {
            return;
          }
          window.dispatchEvent(new Event(CONSENT_EVENT));
        }}
      />
      {enabled ? (
        <Script
          id="public-google-analytics"
          src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
          strategy="afterInteractive"
          onLoad={sendPageView}
          onReady={sendPageView}
        />
      ) : null}
    </div>
  );
}
