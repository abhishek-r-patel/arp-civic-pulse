// Guards public canonical metadata and keeps private resident URLs out of discovery.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PUBLIC_PAGES,
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
    expect(first.alternates?.canonical).toBe(
      `https://civic.example/votes/${id}`,
    );
    expect(first.robots).toEqual({ index: false, follow: false });
    const invalid = await generate({
      params: Promise.resolve({ id: "unexpected/path?email=private" }),
    });
    expect(invalid.alternates).toBeUndefined();
    expect(invalid.title).toBe("Vote");
  });
  it("gives public pages distinct titles, descriptions and canonical URLs", () => {
    vi.stubEnv("APP_ORIGIN", "https://civic.example");
    const metadata = PUBLIC_PAGES.map((page) => publicMetadata(page.path));
    expect(new Set(metadata.map((page) => page.title)).size).toBe(
      PUBLIC_PAGES.length,
    );
    expect(new Set(metadata.map((page) => page.description)).size).toBe(
      PUBLIC_PAGES.length,
    );
    for (const entry of PUBLIC_PAGES) {
      const page = publicMetadata(entry.path);
      expect(page.alternates?.canonical).toBe(
        `https://civic.example${entry.path}`,
      );
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
    ]);
    expect(privateMetadata("Votes", "Your household votes.").robots).toEqual({
      index: false,
      follow: false,
    });
  });
});
