/**
 * Typed client for the MedVault REST API (docs/CONTRACTS.md §3).
 *
 * All calls go to same-origin `/api/*`; Next.js rewrites them to the Go API so the
 * httpOnly `mv_session` cookie stays first-party.
 */
import type {
  ApiErrorBody,
  ApiErrorCode,
  DocumentDetail,
  DocumentListQuery,
  DocumentPatch,
  ExtractedItem,
  HealthStatus,
  ItemReviewInput,
  LabSeries,
  LabTestSummary,
  MedDocument,
  Medication,
  Profile,
  ProfileInput,
  ProfileSummary,
  ReviewItem,
  TimelineEvent,
  User,
} from "@/lib/types"

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly fields: Record<string, string>
  readonly existingId: string | null

  constructor(
    status: number,
    code: ApiErrorCode,
    message: string,
    fields: Record<string, string> = {},
    existingId: string | null = null,
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.fields = fields
    this.existingId = existingId
  }
}

const STATUS_TO_CODE: Record<number, ApiErrorCode> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "validation_failed",
  429: "rate_limited",
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false
  const err = (value as { error: unknown }).error
  return typeof err === "object" && err !== null && "message" in err
}

/** Turn any response body (parsed JSON, text, or nothing) into an `ApiError`. */
export function toApiError(status: number, body: unknown): ApiError {
  if (isErrorBody(body)) {
    const { code, message, fields, existing_id } = body.error
    return new ApiError(
      status,
      code ?? STATUS_TO_CODE[status] ?? "internal",
      message || "Request failed",
      fields ?? {},
      existing_id ?? null,
    )
  }
  const fallbackCode = STATUS_TO_CODE[status] ?? "internal"
  // Never surface HTML error pages (proxy 502s etc.) or server internals to the user.
  const plainText = typeof body === "string" && body.trim() && body.length < 300 && !/<[a-z!/]/i.test(body)
  const message =
    status >= 500
      ? "The server had a problem. Please try again."
      : plainText
        ? (body as string).trim()
        : "Request failed"
  return new ApiError(status, fallbackCode, message)
}

/** Called on every 401 so the app can send the user to /login. */
let unauthorizedHandler: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}
export function notifyUnauthorized() {
  unauthorizedHandler?.()
}

type QueryValue = string | number | undefined | null
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ""
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** Don't trigger the global 401 redirect (used by the auth bootstrap). */
  skipAuthRedirect?: boolean
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal, skipAuthRedirect } = options
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err
    throw new ApiError(0, "network_error", "Can't reach MedVault. Check your connection and try again.")
  }

  const parsed = await parseBody(res)
  if (!res.ok) {
    const error = toApiError(res.status, parsed)
    if (res.status === 401 && !skipAuthRedirect) notifyUnauthorized()
    throw error
  }
  return parsed as T
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export const api = {
  health: () => request<HealthStatus>("/health"),

  auth: {
    me: (opts?: { skipAuthRedirect?: boolean }) =>
      request<{ user: User }>("/auth/me", { skipAuthRedirect: opts?.skipAuthRedirect }).then((r) => r.user),
    login: (input: { email: string; password: string }) =>
      request<{ user: User }>("/auth/login", { method: "POST", body: input, skipAuthRedirect: true }).then((r) => r.user),
    register: (input: { email: string; password: string; name: string }) =>
      request<{ user: User }>("/auth/register", { method: "POST", body: input, skipAuthRedirect: true }).then(
        (r) => r.user,
      ),
    logout: () => request<null>("/auth/logout", { method: "POST", skipAuthRedirect: true }),
  },

  profiles: {
    list: () => request<{ profiles: Profile[] }>("/profiles").then((r) => r.profiles),
    get: (pid: string) => request<{ profile: Profile }>(`/profiles/${pid}`).then((r) => r.profile),
    create: (input: ProfileInput) =>
      request<{ profile: Profile }>("/profiles", { method: "POST", body: input }).then((r) => r.profile),
    update: (pid: string, input: Partial<ProfileInput>) =>
      request<{ profile: Profile }>(`/profiles/${pid}`, { method: "PATCH", body: input }).then((r) => r.profile),
    remove: (pid: string) => request<null>(`/profiles/${pid}`, { method: "DELETE" }),
    summary: (pid: string) => request<ProfileSummary>(`/profiles/${pid}/summary`),
  },

  documents: {
    list: (pid: string, query: DocumentListQuery = {}) =>
      request<{ documents: MedDocument[]; total: number }>(
        `/profiles/${pid}/documents${buildQuery({ ...query })}`,
      ),
    get: (id: string) => request<{ document: DocumentDetail }>(`/documents/${id}`).then((r) => r.document),
    update: (id: string, patch: DocumentPatch) =>
      request<{ document: MedDocument }>(`/documents/${id}`, { method: "PATCH", body: patch }).then(
        (r) => r.document,
      ),
    remove: (id: string) => request<null>(`/documents/${id}`, { method: "DELETE" }),
    reprocess: (id: string) =>
      request<{ document: MedDocument }>(`/documents/${id}/reprocess`, { method: "POST" }).then((r) => r.document),
    items: (id: string) => request<{ items: ExtractedItem[] }>(`/documents/${id}/items`).then((r) => r.items),
    fileUrl: (id: string) => `/api/documents/${id}/file`,
  },

  review: {
    list: (pid: string) => request<{ items: ReviewItem[] }>(`/profiles/${pid}/review`).then((r) => r.items),
    decide: (itemId: string, input: ItemReviewInput) =>
      request<{ item: ExtractedItem }>(`/items/${itemId}`, { method: "PATCH", body: input }).then((r) => r.item),
  },

  timeline: (pid: string) =>
    request<{ events: TimelineEvent[] }>(`/profiles/${pid}/timeline`).then((r) => r.events),

  labs: {
    list: (pid: string) => request<{ tests: LabTestSummary[] }>(`/profiles/${pid}/labs`).then((r) => r.tests),
    series: (pid: string, code: string) =>
      request<LabSeries>(`/profiles/${pid}/labs/${encodeURIComponent(code)}`),
  },

  medications: (pid: string) =>
    request<{ current: Medication[]; past: Medication[] }>(`/profiles/${pid}/medications`),
}
