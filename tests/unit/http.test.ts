import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { submissionSchema } from "@/shared/contracts/ballots";
import { voteListQuerySchema } from "@/shared/contracts/admin-votes";
import { ApiError, validationError } from "@/server/http/errors";
import {
  errorResponse,
  noContent,
  ok,
  paginated,
} from "@/server/http/response";
import { parseJsonBody, parseParams, parseQuery } from "@/server/http/request";
import { route } from "@/server/http/route";

const A = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "8f6e7c5e-6e38-4c6e-9c0a-5f8f6c1f2a10";

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function jsonRequest(
  payload: string | Uint8Array,
  headers: Record<string, string> = { "content-type": "application/json" },
): Request {
  return new Request("http://localhost:3000/api/test", {
    method: "POST",
    headers,
    body: payload as BodyInit,
  });
}

async function failure(
  promise: Promise<unknown> | (() => unknown),
): Promise<ApiError> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an ApiError.");
}

describe("response envelopes", () => {
  it("wraps data with the request ID and no-store headers", async () => {
    const response = ok({ status: "ok" }, REQUEST_ID);

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      data: { status: "ok" },
      requestId: REQUEST_ID,
    });
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBe(REQUEST_ID);
  });

  it("adds page information to list responses", async () => {
    const page = { limit: 25, nextCursor: null, hasMore: false };
    expect(await body(paginated([], page, REQUEST_ID))).toEqual({
      data: [],
      page,
      requestId: REQUEST_ID,
    });
  });

  it("returns an empty 204 with the support ID", () => {
    const response = noContent(REQUEST_ID);
    expect(response.status).toBe(204);
    expect(response.headers.get("x-request-id")).toBe(REQUEST_ID);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("renders errors without a data field and with Retry-After in whole seconds", async () => {
    const response = errorResponse(
      new ApiError("RATE_LIMITED", { retryAfterSeconds: 12.2 }),
      REQUEST_ID,
    );
    const payload = await body(response);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("13");
    expect(payload).not.toHaveProperty("data");
    expect(payload).toMatchObject({
      error: { code: "RATE_LIMITED" },
      requestId: REQUEST_ID,
    });
  });

  it.each([
    ["MALFORMED_JSON", 400],
    ["CSRF_FAILED", 403],
    ["EXPORT_FORMAT_UNAVAILABLE", 404],
    ["STALE_REVISION", 409],
    ["REQUEST_TOO_LARGE", 413],
    ["UNSUPPORTED_MEDIA_TYPE", 415],
    ["VALIDATION_FAILED", 422],
    ["INTERNAL_ERROR", 500],
    ["PROVISIONING_INCOMPLETE", 503],
    ["EXPORT_FAILED", 503],
  ] as const)("maps %s to %i", (code, status) => {
    expect(new ApiError(code).status).toBe(status);
  });
});

describe("validation errors", () => {
  it("reports indexed field paths and never submitted values", async () => {
    const secret = "44444444-4444-4444-8444-444444444444";
    const result = submissionSchema.safeParse({
      confirmed: true,
      selections: [{ officeId: A, candidateId: secret, accountId: secret }],
    });
    if (result.success) {
      throw new Error("Expected validation to fail.");
    }

    const text = JSON.stringify(
      await body(errorResponse(validationError(result.error), REQUEST_ID)),
    );
    expect(text).not.toContain(secret);
    expect(text).toContain("VALIDATION_FAILED");
  });

  it("does not echo unrecognized key names", () => {
    const result = z
      .strictObject({ a: z.string() })
      .safeParse({ a: "x", leakedKey: 1 });
    if (result.success) {
      throw new Error("Expected validation to fail.");
    }
    const error = validationError(result.error);
    expect(JSON.stringify(error.fieldErrors)).not.toContain("leakedKey");
    expect(error.fieldErrors?.[0]?.code).toBe("UNKNOWN_FIELD");
  });

  it("formats nested array paths", () => {
    const result = z
      .strictObject({
        selections: z.array(z.strictObject({ officeId: z.uuid() })),
      })
      .safeParse({ selections: [{ officeId: "nope" }] });
    if (result.success) {
      throw new Error("Expected validation to fail.");
    }
    expect(validationError(result.error).fieldErrors?.[0]?.field).toBe(
      "selections[0].officeId",
    );
  });
});

describe("parseJsonBody", () => {
  const schema = z.strictObject({ name: z.string() });

  it("parses a valid body", async () => {
    expect(await parseJsonBody(jsonRequest('{"name":"a"}'), schema)).toEqual({
      name: "a",
    });
  });

  it("accepts an explicit utf-8 charset", async () => {
    const request = jsonRequest('{"name":"a"}', {
      "content-type": "application/json; charset=utf-8",
    });
    expect(await parseJsonBody(request, schema)).toEqual({ name: "a" });
  });

  it.each([
    undefined,
    "text/plain",
    "application/x-www-form-urlencoded",
    "application/json; charset=latin1",
    "application/jsonp",
  ])("rejects content type %j with 415", async (contentType) => {
    const headers: Record<string, string> = contentType
      ? { "content-type": contentType }
      : {};
    expect(
      (await failure(parseJsonBody(jsonRequest("{}", headers), schema))).code,
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects malformed JSON, empty bodies and invalid UTF-8 with 400", async () => {
    for (const payload of ["{", "", "undefined"]) {
      expect(
        (await failure(parseJsonBody(jsonRequest(payload), schema))).code,
      ).toBe("MALFORMED_JSON");
    }
    const invalidUtf8 = new Uint8Array([0x7b, 0xff, 0x7d]);
    expect(
      (await failure(parseJsonBody(jsonRequest(invalidUtf8), schema))).code,
    ).toBe("MALFORMED_JSON");
  });

  it("rejects oversized bodies by declared length and by streamed size with 413", async () => {
    const declared = jsonRequest("{}", {
      "content-type": "application/json",
      "content-length": "999999",
    });
    expect((await failure(parseJsonBody(declared, schema, 1024))).code).toBe(
      "REQUEST_TOO_LARGE",
    );

    const streamed = jsonRequest(`{"name":"${"a".repeat(2048)}"}`);
    expect((await failure(parseJsonBody(streamed, schema, 1024))).code).toBe(
      "REQUEST_TOO_LARGE",
    );
  });

  it("rejects excessive nesting", async () => {
    const nested = "[".repeat(40) + "]".repeat(40);
    expect(
      (await failure(parseJsonBody(jsonRequest(nested), z.unknown()))).code,
    ).toBe("REQUEST_TOO_LARGE");
  });

  it("returns 422 with field errors for invalid or unknown input", async () => {
    const error = await failure(
      parseJsonBody(jsonRequest('{"name":1,"extra":true}'), schema),
    );
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.fieldErrors?.length).toBeGreaterThan(0);
  });
});

describe("parseQuery and parseParams", () => {
  const request = (query: string) =>
    new Request(`http://localhost:3000/api/votes${query}`);

  it("parses and applies defaults", () => {
    expect(
      parseQuery(request("?status=ACTIVE"), voteListQuerySchema),
    ).toMatchObject({
      limit: 25,
      status: "ACTIVE",
    });
  });

  it("rejects unknown filters, invalid enums and repeated parameters with 422", () => {
    for (const query of [
      "?offset=1",
      "?status=nope",
      "?limit=1&limit=2",
      "?limit=0",
    ]) {
      expect(() => parseQuery(request(query), voteListQuerySchema)).toThrow(
        ApiError,
      );
    }
  });

  it("treats a malformed path identifier as not found", () => {
    expect(parseParams({ id: A }, z.object({ id: z.uuid() }))).toEqual({
      id: A,
    });
    expect(() =>
      parseParams({ id: "1" }, z.object({ id: z.uuid() })),
    ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});

describe("route", () => {
  const handlers = route({
    GET: ({ requestId }) => ok({ hello: "world" }, requestId),
  });
  const call = (method: keyof typeof handlers) =>
    handlers[method](new Request("http://localhost:3000/api/test", { method }));

  it("serves supported methods with a request ID header", async () => {
    const response = await call("GET");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe(
      (await body(response)).requestId,
    );
  });

  it("returns 405 with Allow for unsupported methods", async () => {
    const response = await call("POST");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(await body(response)).toMatchObject({
      error: { code: "METHOD_NOT_ALLOWED" },
    });
  });

  it("maps thrown ApiErrors to their envelope", async () => {
    const failing = route({
      GET: () => {
        throw new ApiError("FORBIDDEN");
      },
    });
    const response = await failing.GET(
      new Request("http://localhost:3000/api/test"),
    );
    expect(response.status).toBe(403);
  });

  it("converts unexpected failures into a safe 500 without leaking details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = route({
      GET: () => {
        throw new Error("password=hunter2 select * from votes");
      },
    });
    const response = await failing.GET(
      new Request("http://localhost:3000/api/test?email=a@b.test"),
    );
    const text = JSON.stringify(await body(response));

    expect(response.status).toBe(500);
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("hunter2");
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("request.unhandled");
    expect(logged).not.toContain("hunter2");
    expect(logged).not.toContain("a@b.test");
    spy.mockRestore();
  });

  it("passes awaited route params to the handler", async () => {
    const withParams = route({
      GET: ({ params, requestId }) => ok({ id: params.id }, requestId),
    });
    const response = await withParams.GET(
      new Request("http://localhost:3000/api/x/1"),
      {
        params: Promise.resolve({ id: "abc" }),
      },
    );
    expect((await body(response)).data).toEqual({ id: "abc" });
  });
});
