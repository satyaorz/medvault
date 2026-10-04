"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { POLL_INTERVAL_MS } from "@/lib/constants"
import { isInFlight } from "@/lib/format"
import { qk } from "@/lib/query-keys"
import type { DocumentListQuery, DocumentPatch, MedDocument } from "@/lib/types"

export function useDocuments(pid: string, query: DocumentListQuery) {
  return useQuery({
    queryKey: qk.documentList(pid, query),
    queryFn: () => api.documents.list(pid, query),
    placeholderData: (previous) => previous,
    refetchInterval: (q) => (q.state.data?.documents.some((d) => isInFlight(d.status)) ? POLL_INTERVAL_MS : false),
  })
}

export function useDocument(id: string) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: qk.document(id),
    queryFn: async () => {
      const previous = queryClient.getQueryData<MedDocument>(qk.document(id))
      const doc = await api.documents.get(id)
      // When processing finishes, everything derived from this document may have changed.
      if (previous && isInFlight(previous.status) && !isInFlight(doc.status)) {
        queryClient.invalidateQueries({ queryKey: qk.documentItems(id) })
        queryClient.invalidateQueries({ queryKey: qk.profile(doc.profile_id) })
      }
      return doc
    },
    refetchInterval: (q) => (q.state.data && isInFlight(q.state.data.status) ? POLL_INTERVAL_MS : false),
  })
}

export function useDocumentItems(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.documentItems(id),
    queryFn: () => api.documents.items(id),
    enabled,
  })
}

function useInvalidateDocument() {
  const queryClient = useQueryClient()
  return (doc: Pick<MedDocument, "id" | "profile_id">) => {
    queryClient.invalidateQueries({ queryKey: qk.document(doc.id) })
    queryClient.invalidateQueries({ queryKey: qk.profile(doc.profile_id) })
    queryClient.invalidateQueries({ queryKey: qk.profiles })
  }
}

export function useUpdateDocument() {
  const invalidate = useInvalidateDocument()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: DocumentPatch }) => api.documents.update(id, patch),
    onSuccess: invalidate,
  })
}

export function useReprocessDocument() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateDocument()
  return useMutation({
    mutationFn: (id: string) => api.documents.reprocess(id),
    onSuccess: (doc) => {
      queryClient.removeQueries({ queryKey: qk.documentItems(doc.id) })
      invalidate(doc)
    },
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; profileId: string }) => api.documents.remove(id),
    onSuccess: (_data, { id, profileId }) => {
      queryClient.removeQueries({ queryKey: ["document", id] })
      queryClient.invalidateQueries({ queryKey: qk.profile(profileId) })
      queryClient.invalidateQueries({ queryKey: qk.profiles })
    },
  })
}
