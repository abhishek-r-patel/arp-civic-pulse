// Guards public canonical metadata and keeps private resident URLs out of discovery.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAIN_PUBLIC_PAGES,
  PUBLIC_PAGES,
  mainPublicMetadata,
  privateMetadata,
  privateRecordMetadata,
  publicMetadata,
} from "@/shared/metadata";

afterEach(() => vi.unstubAllEnvs());

describe("launch metadata", () => {
  it("gives private records unique titles and canonical URLs without names or choices", async () => {
    vi.stubEnv("APP_ORIGIN", "https://civic.example");
    const generate = privateRecordMetadata(
      "Vote",
      "Review your eligible vote.",
      "/votes/[id]",
    );
    const id = "11111111-1111-4111-8111-111111111111";
    const first = await generate({ params: Promise.resolve({ id }) });
    const second = await generate({
      params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }),
    });
    expect(first.title).not.toBe(second.title);
    expect(first.alternates?.canonical).toBe(`/votes/${id}`);
    expect(first.robots).toEqual({ index: false, follow: false });
    const invalid = await generate({
      params: Promise.resolve({ id: "unexpected/path?email=private" }),
    });
    expect(invalid.alternates).toBeUndefined();
    expect(invalid.title).toBe("Vote");
  });
  it("gives public pages distinct titles, descriptions and host-relative canonical URLs", () => {
    const metadata = PUBLIC_PAGES.map((page) => publicMetadata(page.path));
    expect(new Set(metadata.map((page) => page.title)).size).toBe(
      PUBLIC_PAGES.length,
    );
    expect(new Set(metadata.map((page) => page.description)).size).toBe(
      PUBLIC_PAGES.length,
    );
    // Resolved against the requesting host's metadataBase, never another host.
    for (const entry of PUBLIC_PAGES) {
      const page = publicMetadata(entry.path);
      expect(page.alternates?.canonical).toBe(entry.path);
      expect(page.robots).toEqual({ index: true, follow: true });
      expect(page.openGraph).toMatchObject({
        images: [{ url: "/opengraph-image", alt: expect.any(String) }],
      });
    }
  });

  it("does not publish protected application routes", () => {
    expect(PUBLIC_PAGES.map((page) => page.path)).toEqual([
      "/sign-in",
      "/privacy",
      "/contact",
      "/user-guide",
      "/user-guide/resident",
      "/user-guide/rwa-admin",
    ]);
    expect(privateMetadata("Votes", "Your household votes.").robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("keeps main website pages separate from RWA pages", () => {
    expect(MAIN_PUBLIC_PAGES.map((page) => page.path)).toEqual([
      "/",
      "/contact",
      "/privacy",
    ]);
    for (const entry of MAIN_PUBLIC_PAGES) {
      const page = mainPublicMetadata(entry.path);
      expect(page.alternates?.canonical).toBe(entry.path);
      expect(page.robots).toEqual({ index: true, follow: true });
    }
  });
});
