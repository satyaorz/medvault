import { ApiError, notifyUnauthorized, toApiError } from "@/lib/api"
import type { DocType, ISODate, MedDocument } from "@/lib/types"

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const ACCEPTED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const
export const ACCEPT_ATTRIBUTE = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"

const EXTENSION_TO_MIME: Record<string, (typeof ACCEPTED_MIME_TYPES)[number]> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
}

/** Client-side pre-check. The server sniffs content too, this is just fast feedback. */
export function validateUploadFile(file: Pick<File, "name" | "size" | "type">): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  const typeOk =
    (ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type) || (!file.type && ext in EXTENSION_TO_MIME)
  if (!typeOk) return "Only PDF, PNG, JPEG or WEBP files are supported."
  if (file.size === 0) return "This file is empty."
  if (file.size > MAX_UPLOAD_BYTES) return "Files must be 20 MB or smaller."
  return null
}

export interface UploadMetadata {
  title?: string
  doc_date?: ISODate
  doc_type?: DocType
  source?: string
}

export interface UploadHandle {
  promise: Promise<MedDocument>
  abort: () => void
}

/**
 * Multipart upload via XHR (fetch has no upload-progress events).
 * Resolves with the created document (202) or rejects with an `ApiError`.
 */
export function uploadDocument(
  profileId: string,
  file: File,
  metadata: UploadMetadata,
  onProgress?: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<MedDocument>((resolve, reject) => {
    const form = new FormData()
    form.append("file", file)
    for (const [key, value] of Object.entries(metadata)) {
      if (value) form.append(key, value)
    }

    xhr.open("POST", `/api/profiles/${profileId}/documents`)
    xhr.withCredentials = true
    xhr.setRequestHeader("Accept", "application/json")

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        body = xhr.responseText
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1)
        resolve((body as { document: MedDocument }).document)
        return
      }
      if (xhr.status === 401) notifyUnauthorized()
      reject(toApiError(xhr.status, body))
    }
    xhr.onerror = () =>
      reject(new ApiError(0, "network_error", "Upload failed — check your connection and try again."))
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"))
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}
