import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "@/server/http/errors";
import {
  assertBrowserMutation,
  createCsrfContext,
  csrfTokenFor,
} from "@/server/http/browser-protection";
import { buildPage, decodeCursor, encodeCursor } from "@/server/http/cursor";
import { log, sanitizeFields, shouldLog } from "@/server/observability/logger";
import { vi } from "vitest";

const ORIGIN = "https://vote.example.test";
const A = "11111111-1111-4111-8111-111111111111";
const position = z.object({ createdAt: z.string(), id: z.uuid() });

function mutation(headers: Record<string, string>): Request {
  return new Request(`${ORIGIN}/api/auth/code`, { method: "POST", headers });
}

function codeOf(action: () => void): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof ApiError ? error.code : undefined;
  }
  return undefined;
}

describe("assertBrowserMutation", () => {
  const context = createCsrfContext();
  const token = csrfTokenFor(context);
  const check = (
    headers: Record<string, string>,
    csrfContext: string | null = context,
  ) =>
    codeOf(() =>
      assertBrowserMutation(mutation(headers), {
        appOrigin: ORIGIN,
        csrfContext: csrfContext ?? undefined,
      }),
    );

  it("accepts a matching origin and token", () => {
    expect(check({ origin: ORIGIN, "x-csrf-token": token })).toBeUndefined();
  });

  it("rejects a missing, mismatched or null origin with CSRF_FAILED", () => {
    expect(check({ "x-csrf-token": token })).toBe("CSRF_FAILED");
    expect(
      check({ origin: "https://evil.example.test", "x-csrf-token": token }),
    ).toBe("CSRF_FAILED");
    expect(
      check({ origin: `${ORIGIN}.evil.test`, "x-csrf-token": token }),
    ).toBe("CSRF_FAILED");
    expect(check({ origin: "null", "x-csrf-token": token })).toBe(
      "CSRF_FAILED",
    );
    expect(
      check({ origin: "http://vote.example.test", "x-csrf-token": token }),
    ).toBe("CSRF_FAILED");
  });

  it("rejects missing, wrong or context-less tokens", () => {
    expect(check({ origin: ORIGIN })).toBe("CSRF_FAILED");
    expect(check({ origin: ORIGIN, "x-csrf-token": "wrong" })).toBe(
      "CSRF_FAILED",
    );
    expect(
      check({
        origin: ORIGIN,
        "x-csrf-token": csrfTokenFor(createCsrfContext()),
      }),
    ).toBe("CSRF_FAILED");
    expect(check({ origin: ORIGIN, "x-csrf-token": token }, null)).toBe(
      "CSRF_FAILED",
    );
  });

  it("derives a token that does not reveal the context and differs per context", () => {
    expect(token).not.toContain(context);
    expect(csrfTokenFor(context)).toBe(token);
    expect(csrfTokenFor(createCsrfContext())).not.toBe(token);
  });
});

describe("cursors", () => {
  const binding = { endpoint: "/api/votes", filters: { status: "ACTIVE" } };
  const sample = { createdAt: "2030-01-01T00:00:00.000Z", id: A };

  it("round-trips a position", () => {
    expect(
      decodeCursor(encodeCursor(binding, sample), binding, position),
    ).toEqual(sample);
  });

  it("ignores filter ordering and undefined filters", () => {
    const cursor = encodeCursor(
      { endpoint: "/e", filters: { a: "1", b: undefined, c: "2" } },
      sample,
    );
    expect(
      decodeCursor(
        cursor,
        { endpoint: "/e", filters: { c: "2", a: "1" } },
        position,
      ),
    ).toEqual(sample);
  });

  it("is bound to endpoint, filters and parent vote", () => {
    const cursor = encodeCursor({ ...binding, parentId: A }, sample);
    for (const other of [
      { endpoint: "/api/admin/votes", filters: binding.filters, parentId: A },
      {
        endpoint: binding.endpoint,
        filters: { status: "COMPLETED" },
        parentId: A,
      },
      { endpoint: binding.endpoint, filters: binding.filters },
      { ...binding, parentId: "22222222-2222-4222-8222-222222222222" },
    ]) {
      expect(codeOf(() => decodeCursor(cursor, other, position))).toBe(
        "VALIDATION_FAILED",
      );
    }
  });

  it("rejects garbage, oversized, tampered and wrongly-shaped cursors with 422", () => {
    const valid = encodeCursor(binding, sample);
    const wrongShape = encodeCursor(binding, { other: "x" });
    const unknownVersion = Buffer.from(
      JSON.stringify({ v: 2, b: "x", p: {} }),
    ).toString("base64url");

    for (const cursor of [
      "!!!",
      "",
      "x".repeat(600),
      valid.slice(0, -3),
      wrongShape,
      unknownVersion,
      "e30",
    ]) {
      expect(codeOf(() => decodeCursor(cursor, binding, position))).toBe(
        "VALIDATION_FAILED",
      );
    }
  });

  it("builds pages using the extra row to detect more results", () => {
    const rows = [1, 2, 3];
    const page = buildPage(rows, 2, binding, (row) => ({ n: String(row) }));
    expect(page.rows).toEqual([1, 2]);
    expect(page.page).toMatchObject({ limit: 2, hasMore: true });
    expect(page.page.nextCursor).not.toBeNull();
    expect(
      decodeCursor(
        page.page.nextCursor ?? "",
        binding,
        z.object({ n: z.string() }),
      ),
    ).toEqual({ n: "2" });
  });

  it("has no next cursor on the final or an empty page", () => {
    expect(
      buildPage([1, 2], 2, binding, (row) => ({ n: String(row) })).page,
    ).toEqual({
      limit: 2,
      hasMore: false,
      nextCursor: null,
    });
    expect(buildPage([], 25, binding, () => ({})).page.nextCursor).toBeNull();
  });
});

describe("logging", () => {
  it("keeps only allowlisted primitive fields", () => {
    expect(
      sanitizeFields({
        requestId: "r1",
        status: 500,
        email: "a@example.test",
        body: { selections: [1] },
        cookie: "sb-access-token=abc",
        errorName: { nested: true },
        durationMs: Number.NaN,
      }),
    ).toEqual({ requestId: "r1", status: 500 });
  });

  it("strips line breaks and truncates long values", () => {
    const fields = sanitizeFields({
      route: `/a\nforged-line${"x".repeat(500)}`,
    });
    expect(fields.route).not.toContain("\n");
    expect(String(fields.route).length).toBeLessThanOrEqual(200);
  });

  it("filters by configured level", () => {
    expect(shouldLog("info", "error")).toBe(true);
    expect(shouldLog("info", "debug")).toBe(false);
    expect(shouldLog("error", "warn")).toBe(false);
  });

  it("writes structured lines without non-allowlisted data", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log("error", "request.unhandled", { requestId: "r1", password: "hunter2" });
    expect(spy).toHaveBeenCalledWith(
      '{"level":"error","event":"request.unhandled","requestId":"r1"}',
    );
    spy.mockRestore();
  });
});
