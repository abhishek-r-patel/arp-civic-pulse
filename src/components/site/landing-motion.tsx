// Progressive scroll reveals for the main-host landing page, with reduced-motion support.
"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function LandingMotion({ children }: Readonly<{ children: ReactNode }>) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sections = root.querySelectorAll<HTMLElement>("[data-scroll-reveal]");
    const words = root.querySelectorAll<HTMLElement>("[data-tagline-word]");
    let sectionObserver: IntersectionObserver | undefined;
    let wordObserver: IntersectionObserver | undefined;
    let timers: number[] = [];

    function revealEverything() {
      root?.removeAttribute("data-motion-ready");
      sections.forEach((section) => section.classList.add("is-visible"));
      words.forEach((word) => word.classList.add("is-active"));
    }

    function initialize() {
      sectionObserver?.disconnect();
      wordObserver?.disconnect();
      timers.forEach(window.clearTimeout);
      timers = [];

      if (reducedMotion.matches || !("IntersectionObserver" in window)) {
        revealEverything();
        return;
      }

      if (!root) return;
      root.dataset.motionReady = "true";
      sectionObserver = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        },
        { threshold: 0.12 },
      );
      sections.forEach((section) => sectionObserver?.observe(section));

      wordObserver = new IntersectionObserver(
        (entries, observer) => {
          const visibleWords = entries
            .filter((entry) => entry.isIntersecting)
            .sort(
              (left, right) =>
                Number((left.target as HTMLElement).dataset.wordIndex ?? 0) -
                Number((right.target as HTMLElement).dataset.wordIndex ?? 0),
            );
          visibleWords.forEach((entry, index) => {
            timers.push(
              window.setTimeout(
                () => entry.target.classList.add("is-active"),
                index * 65,
              ),
            );
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.2, rootMargin: "-38% 0px -38% 0px" },
      );
      words.forEach((word) => wordObserver?.observe(word));
    }

    initialize();
    reducedMotion.addEventListener("change", initialize);
    return () => {
      reducedMotion.removeEventListener("change", initialize);
      sectionObserver?.disconnect();
      wordObserver?.disconnect();
      timers.forEach(window.clearTimeout);
    };
  }, []);

  return (
    <div ref={rootRef} className="product-motion-root">
      {children}
    </div>
  );
}
