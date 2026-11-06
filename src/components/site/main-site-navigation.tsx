// Responsive main-host navigation with the shared appearance switcher and configured demo link.
"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";

const NAVIGATION = [
  { href: "/#examples", label: "Vote examples" },
  { href: "/#features", label: "Benefits" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#pricing", label: "Annual plan" },
  { href: "/#faq", label: "FAQ" },
] as const;

export function MainSiteNavigation({
  demoOrigin,
}: Readonly<{ demoOrigin: string | undefined }>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    firstLinkRef.current?.focus();

    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !headerRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header ref={headerRef} className="product-navigation">
      <div className="product-navigation-inner">
        <Link
          href="/"
          aria-label="Civic Pulse home"
          className="product-brand"
          onClick={closeMenu}
        >
          <Image src="/icon.svg" width={40} height={40} alt="" />
          <span>Civic Pulse</span>
        </Link>
        <nav className="product-desktop-nav" aria-label="Main">
          {NAVIGATION.map((item) => (
            <Link key={item.href} href={item.href} className="product-nav-link">
              {item.label}
            </Link>
          ))}
          {demoOrigin ? (
            <a href={demoOrigin} className="product-nav-link">
              Try the demo
            </a>
          ) : null}
        </nav>
        <div className="product-navigation-actions">
          <ThemeSwitcher />
          <Link href="/contact" className="product-primary product-desktop-cta">
            Ask for a quote
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="product-menu-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="product-mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="product-menu-icon" aria-hidden="true">
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>
      <div
        className={`product-mobile-menu${menuOpen ? "is-open" : ""}`}
        id="product-mobile-menu"
        aria-hidden={!menuOpen}
        inert={!menuOpen}
      >
        <div className="product-mobile-menu-heading">
          <span>Explore Civic Pulse</span>
          <button
            type="button"
            className="product-menu-close"
            onClick={() => {
              closeMenu();
              toggleRef.current?.focus();
            }}
          >
            Close menu
          </button>
        </div>
        <nav aria-label="Mobile">
          {NAVIGATION.map((item, index) => (
            <Link
              key={item.href}
              ref={index === 0 ? firstLinkRef : undefined}
              href={item.href}
              className="product-mobile-link"
              onClick={closeMenu}
            >
              {item.label}
            </Link>
          ))}
          {demoOrigin ? (
            <a
              href={demoOrigin}
              className="product-mobile-link"
              onClick={closeMenu}
            >
              Try the demo
            </a>
          ) : null}
        </nav>
        <Link href="/contact" className="product-primary" onClick={closeMenu}>
          Ask for a quote
        </Link>
      </div>
    </header>
  );
}
