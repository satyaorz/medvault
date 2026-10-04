import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, api, buildQuery, request, setUnauthorizedHandler, toApiError } from "@/lib/api"

function mockFetch(status: number, body?: unknown) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)
  const fn = vi.fn().mockResolvedValue(new Response(status === 204 ? null : text, { status }))
  vi.stubGlobal("fetch", fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(null)
})

describe("toApiError", () => {
  it("parses the contract error envelope including fields and existing_id", () => {
    const err = toApiError(422, {
      error: { code: "validation_failed", message: "invalid input", fields: { email: "invalid email" } },
    })
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe("validation_failed")
    expect(err.fields).toEqual({ email: "invalid email" })

    const dup = toApiError(409, { error: { code: "conflict", message: "duplicate", existing_id: "doc-1" } })
    expect(dup.existingId).toBe("doc-1")
  })
  it("falls back to a code derived from the status for non-JSON bodies", () => {
    expect(toApiError(413, "Request Entity Too Large").code).toBe("payload_too_large")
    expect(toApiError(502, "<html>bad gateway</html>").message).toMatch(/server had a problem/i)
  })
})

describe("buildQuery", () => {
  it("drops empty values", () => {
    expect(buildQuery({ q: "hba1c", type: undefined, limit: 20, offset: 0, status: "" })).toBe("?q=hba1c&limit=20&offset=0")
    expect(buildQuery({})).toBe("")
  })
})

describe("request", () => {
  it("returns parsed JSON and sends JSON bodies", async () => {
    const fetchMock = mockFetch(201, { user: { id: "u1" } })
    const user = await api.auth.register({ email: "a@b.co", password: "password1", name: "A" })
    expect(user).toEqual({ id: "u1" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/auth/register")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.co", password: "password1", name: "A" })
  })

  it("handles 204 No Content", async () => {
    mockFetch(204)
    await expect(api.documents.remove("d1")).resolves.toBeNull()
  })

  it("calls the unauthorized handler on 401", async () => {
    mockFetch(401, { error: { code: "unauthorized", message: "login required" } })
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await expect(request("/profiles")).rejects.toMatchObject({ status: 401, code: "unauthorized" })
    expect(handler).toHaveBeenCalledOnce()
  })

  it("does not redirect for auth endpoints (bad password shows inline)", async () => {
    mockFetch(401, { error: { code: "unauthorized", message: "invalid credentials" } })
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    await expect(api.auth.login({ email: "a@b.co", password: "x" })).rejects.toBeInstanceOf(ApiError)
    expect(handler).not.toHaveBeenCalled()
  })

  it("maps network failures to a friendly ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(request("/health")).rejects.toMatchObject({ status: 0, code: "network_error" })
  })

  it("encodes lab codes in the URL", async () => {
    const fetchMock = mockFetch(200, { test: { code: "raw:t3 total", name: "T3", unit: null }, results: [] })
    await api.labs.series("p1", "raw:t3 total")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/profiles/p1/labs/raw%3At3%20total")
  })
})
