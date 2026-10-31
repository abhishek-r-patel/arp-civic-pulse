// Error IDs, the error catalogue, failure logging, cause capture and Sentry tagging.
import { afterEach, describe, expect, it, vi } from "vitest";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import { toApiError } from "@/server/db/errors";
import {
  ApiError,
  errorDefinition,
  listErrorCodes,
} from "@/server/http/errors";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { log } from "@/server/observability/logger";
import {
  areaForPath,
  isErrorId,
  newErrorId,
} from "@/shared/observability/error-id";
import { scrubEvent } from "@/shared/observability/sentry";

function captureLogs() {
  const lines: Record<string, unknown>[] = [];
  const push = (line: unknown) => {
    lines.push(JSON.parse(String(line)) as Record<string, unknown>);
  };
  vi.spyOn(console, "log").mockImplementation(push);
  vi.spyOn(console, "warn").mockImplementation(push);
  vi.spyOn(console, "error").mockImplementation(push);
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
  captureException.mockReset();
});

describe("error IDs", () => {
  it("are readable, area-prefixed and random", () => {
    const id = newErrorId("AUTH");
    expect(id).toMatch(/^AUTH-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/u);
    expect(isErrorId(id)).toBe(true);
    expect(newErrorId("AUTH")).not.toBe(id);
    expect(isErrorId("AUTH-OOOOO-IIIII")).toBe(false);
  });

  it.each([
    ["/api/auth/code", "AUTH"],
    ["/api/votes", "VOTE"],
    ["/api/votes/abc/submission", "VOTE"],
    ["/api/votes/abc/exports/pdf", "EXPORT"],
    ["/api/admin/votes/abc/activate", "VOTEADMIN"],
    ["/api/admin/accounts/abc", "REGISTER"],
    ["/api/admin/households/import", "REGISTER"],
    ["/api/admin/settings/app-support", "SETTINGS"],
    ["/api/admin/audit", "AUDIT"],
    ["/api/register", "SIGNUP"],
    ["/api/contact", "CONTACT"],
    ["/api/internal/health", "HEALTH"],
    ["/api/unknown", "API"],
    ["/api/authority", "API"],
  ])("maps %s to %s", (path, area) => {
    expect(areaForPath(path)).toBe(area);
  });
});

describe("error catalogue", () => {
  it.each(listErrorCodes())("%s has complete operator metadata", (code) => {
    const definition = errorDefinition(code);
    expect(definition.hint.length).toBeGreaterThan(20);
    // Hints must fit the logger's 200-character value limit.
    expect(definition.hint.length).toBeLessThanOrEqual(200);
    expect(definition.type === "system").toBe(definition.status >= 500);
    expect(definition.level === "error").toBe(definition.type === "system");
  });

  it("keeps only identifier-like cause codes", () => {
    const error = new ApiError("DEPENDENCY_UNAVAILABLE", {
      cause: {
        source: "database",
        code: "bad value with a@b.test",
        status: 503,
      },
    });
    expect(error.safeCause).toEqual({
      source: "database",
      code: "unrecognized",
      status: 503,
    });
    expect(error.reportable).toBe(true);
    expect(new ApiError("FORBIDDEN").reportable).toBe(false);
    expect(new ApiError("INTERNAL_ERROR", { report: false }).reportable).toBe(
      false,
    );
  });

  it("records the database cause without free-form text", () => {
    expect(
      toApiError({ code: "P0001", message: "INVARIANT_VIOLATION", status: 400 })
        .safeCause,
    ).toEqual({
      source: "database",
      code: "P0001:INVARIANT_VIOLATION",
      status: 400,
    });
    expect(
      toApiError({ code: "P0001", message: "row for a@b.test", status: 400 })
        .safeCause?.code,
    ).toBe("P0001");
    expect(toApiError({ code: "57014", status: 500 }).safeCause).toEqual({
      source: "database",
      code: "57014",
      status: 500,
    });
  });
});

describe("request failure logging", () => {
  it("logs a user failure with category, hint and the response's error ID", async () => {
    const lines = captureLogs();
    const handlers = route({
      GET: () => {
        log("warn", "nested.event", { errorCode: "X" });
        throw new ApiError("FORBIDDEN");
      },
    });
    const response = await handlers.GET(
      new Request("http://localhost:3000/api/admin/votes/1"),
    );
    const id = response.headers.get("x-request-id") ?? "";

    expect(id).toMatch(/^VOTEADMIN-/u);
    expect(((await response.json()) as { requestId: string }).requestId).toBe(
      id,
    );
    expect(lines.find((line) => line.event === "nested.event")).toMatchObject({
      requestId: id,
      area: "VOTEADMIN",
      route: "/api/admin/votes/1",
      method: "GET",
      host: "localhost:3000",
    });
    expect(lines.find((line) => line.event === "request.failed")).toMatchObject(
      {
        level: "info",
        requestId: id,
        status: 403,
        errorCode: "FORBIDDEN",
        errorCategory: "authorization",
        errorType: "user",
        hint: errorDefinition("FORBIDDEN").hint,
      },
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("logs and reports a system failure with its safe cause", async () => {
    const lines = captureLogs();
    const handlers = route({
      POST: () => {
        throw toApiError({ code: "57014", status: 500 });
      },
    });
    const response = await handlers.POST(
      new Request("http://localhost:3000/api/votes/1/submission", {
        method: "POST",
      }),
    );
    const id = response.headers.get("x-request-id");

    expect(response.status).toBe(503);
    expect(lines.find((line) => line.event === "request.failed")).toMatchObject(
      {
        level: "error",
        requestId: id,
        errorCode: "DEPENDENCY_UNAVAILABLE",
        errorCategory: "dependency",
        errorType: "system",
        causeSource: "database",
        causeCode: "57014",
        causeStatus: 500,
      },
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      tags: {
        error_id: id,
        area: "VOTE",
        error_code: "DEPENDENCY_UNAVAILABLE",
        error_category: "dependency",
        cause_code: "57014",
      },
    });
  });

  it("logs but does not report system errors marked report: false", async () => {
    const lines = captureLogs();
    const handlers = route({
      GET: () => {
        throw new ApiError("DEPENDENCY_UNAVAILABLE", {
          cause: { source: "maintenance", code: "MAINTENANCE_MODE" },
          report: false,
        });
      },
    });
    await handlers.GET(new Request("http://localhost:3000/api/votes"));
    expect(
      lines.find((line) => line.event === "request.failed")?.causeCode,
    ).toBe("MAINTENANCE_MODE");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports unexpected errors under the same error ID without their message", async () => {
    const lines = captureLogs();
    const handlers = route({
      GET: () => {
        throw new TypeError("secret a@b.test");
      },
    });
    const response = await handlers.GET(
      new Request("http://localhost:3000/api/auth/code"),
    );
    const id = response.headers.get("x-request-id");
    const unhandled = lines.find((line) => line.event === "request.unhandled");

    expect(unhandled).toMatchObject({
      requestId: id,
      errorName: "TypeError",
      errorCode: "INTERNAL_ERROR",
      errorCategory: "internal",
    });
    expect(JSON.stringify(lines)).not.toContain("a@b.test");
    expect(captureException.mock.calls[0]?.[1]).toMatchObject({
      tags: { error_id: id, area: "AUTH", error_code: "INTERNAL_ERROR" },
    });
  });

  it("keeps request context out of logs written outside a request", async () => {
    const lines = captureLogs();
    await route({ GET: ({ requestId }) => ok({}, requestId) }).GET(
      new Request("http://localhost:3000/api/votes"),
    );
    log("warn", "outside.event");
    expect(lines.at(-1)).toEqual({ level: "warn", event: "outside.event" });
  });

  it("keeps each interleaved request's host and error ID on its own logs", async () => {
    const lines = captureLogs();
    const gates = new Map<string, () => void>();
    const handlers = route({
      GET: async ({ request }) => {
        const host = new URL(request.url).host;
        await new Promise<void>((resolve) => gates.set(host, resolve));
        log("warn", "nested.event");
        throw new ApiError("FORBIDDEN");
      },
    });
    const first = handlers.GET(
      new Request("http://tenant-a.example.test/api/votes"),
    );
    const second = handlers.GET(
      new Request("http://tenant-b.example.test/api/votes"),
    );
    await vi.waitFor(() => expect(gates.size).toBe(2));
    // Finish in reverse order so each continuation resumes after the other started.
    gates.get("tenant-b.example.test")?.();
    const responseB = await second;
    gates.get("tenant-a.example.test")?.();
    const responseA = await first;

    for (const [host, response] of [
      ["tenant-a.example.test", responseA],
      ["tenant-b.example.test", responseB],
    ] as const) {
      const id = response.headers.get("x-request-id");
      const own = lines.filter((line) => line.requestId === id);
      expect(own.map((line) => line.event).sort()).toEqual([
        "nested.event",
        "request.failed",
      ]);
      expect(own.every((line) => line.host === host)).toBe(true);
    }
  });
});

describe("Sentry tag scrubbing", () => {
  it("masks personal data that reaches a tag", () => {
    const event = scrubEvent({
      tags: { error_id: "AUTH-7K3QX-M2PTA", note: "a@b.test" },
    });
    expect(event.tags).toEqual({
      error_id: "AUTH-7K3QX-M2PTA",
      note: "[email]",
    });
  });
});
