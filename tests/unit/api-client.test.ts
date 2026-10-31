import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/shared/http/api-client";

afterEach(() => vi.unstubAllGlobals());

function respond(payload: unknown, status = 200, headers: HeadersInit = {}) {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(payload), { status, headers }),
    );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("browser API response handling", () => {
  it.each(
    [
      null,
      [],
      1,
      "unexpected",
      {},
      { data: {}, error: {} },
      { error: { code: "FAILED", message: 123 } },
      { error: { code: "FAILED", message: "Failed", fieldErrors: [null] } },
      { error: { code: "FAILED", message: "Failed", fieldErrors: "invalid" } },
      { error: { code: "FAILED", message: "Failed", context: null } },
      { error: { code: "FAILED", message: "Failed", context: { reason: {} } } },
      { error: { code: {}, message: "Failed" } },
    ].map((payload) => [payload] as const),
  )(
    "returns INVALID_RESPONSE rather than throwing on malformed JSON envelopes: %j",
    async (payload) => {
      respond(payload, 503);
      await expect(apiRequest("/api/votes")).resolves.toMatchObject({
        ok: false,
        status: 503,
        code: "INVALID_RESPONSE",
        fieldErrors: [],
        context: {},
      });
    },
  );

  it("does not acknowledge an error-shaped 200 response as a successful mutation", async () => {
    respond({ error: { code: "INTERNAL_ERROR", message: "Failed" } });
    await expect(apiRequest("/api/votes")).resolves.toMatchObject({
      ok: false,
      code: "INVALID_RESPONSE",
    });
  });

  it("preserves successful data and the existing mutation transport options", async () => {
    const fetch = respond({
      data: { submitted: true },
      requestId: "support-id",
    });
    await expect(
      apiRequest("/api/votes/id/submission", {
        method: "POST",
        body: { confirmed: true, optionId: "option" },
        csrfToken: "csrf",
      }),
    ).resolves.toEqual({ ok: true, status: 200, data: { submitted: true } });
    expect(fetch).toHaveBeenCalledWith(
      "/api/votes/id/submission",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "csrf" },
        body: JSON.stringify({ confirmed: true, optionId: "option" }),
      }),
    );
  });

  it("preserves safe validation metadata and retry guidance", async () => {
    const error = {
      code: "VALIDATION_FAILED",
      message: "Check fields.",
      fieldErrors: [
        { field: "name", code: "INVALID", message: "Enter a name." },
      ],
      context: {
        reason: "KNOWN",
        profileBlocked: true,
        count: 1,
        missing: null,
      },
    };
    respond({ error, requestId: "support-id" }, 422, { "retry-after": "12" });
    await expect(apiRequest("/api/admin/accounts")).resolves.toEqual({
      ok: false,
      status: 422,
      ...error,
      requestId: "support-id",
      retryAfterSeconds: 12,
    });
  });

  it("keeps empty optional error metadata usable by the error summary", async () => {
    respond({ error: { code: "FORBIDDEN", message: "Forbidden." } }, 403);
    await expect(apiRequest("/api/admin/accounts")).resolves.toMatchObject({
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      fieldErrors: [],
      context: {},
    });
  });

  it("preserves 204, network failure and non-JSON failure behavior", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(apiRequest("/api/auth/sign-out")).resolves.toMatchObject({
      ok: true,
      status: 204,
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(apiRequest("/api/votes")).resolves.toMatchObject({
      ok: false,
      code: "NETWORK_ERROR",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>unavailable</html>", { status: 502 }),
        ),
    );
    await expect(apiRequest("/api/votes")).resolves.toMatchObject({
      ok: false,
      code: "INVALID_RESPONSE",
      status: 502,
    });
  });

  it("gives an unexpected reply a searchable error ID", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>timeout</html>", {
          status: 504,
          headers: { "x-vercel-id": "bom1::abcde-123" },
        }),
      ),
    );
    await expect(apiRequest("/api/votes?x=1")).resolves.toMatchObject({
      code: "INVALID_RESPONSE",
      requestId: "bom1::abcde-123",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("oops", { status: 500 })),
    );
    const failure = await apiRequest("/api/votes");
    expect(failure.ok ? null : failure.requestId).toMatch(/^BROWSER-/u);
  });

  it("sends confirmed DELETE mutations with the CSRF token", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      apiRequest<void>("/api/admin/votes/vote-id", {
        method: "DELETE",
        body: { expectedRevision: 2, confirmed: true },
        csrfToken: "csrf",
      }),
    ).resolves.toMatchObject({ ok: true, status: 204 });
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/votes/vote-id",
      expect.objectContaining({
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf",
        },
        body: JSON.stringify({ expectedRevision: 2, confirmed: true }),
      }),
    );
  });
});
