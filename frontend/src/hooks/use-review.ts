"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { qk } from "@/lib/query-keys"
import type { ItemReviewInput, ReviewItem } from "@/lib/types"

export function useReviewQueue(pid: string) {
  return useQuery({ queryKey: qk.review(pid), queryFn: () => api.review.list(pid) })
}

/** Accept/reject an item. Removes it from the queue optimistically and rolls back on error. */
export function useDecideItem(pid: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ item, input }: { item: Pick<ReviewItem, "id" | "document_id">; input: ItemReviewInput }) =>
      api.review.decide(item.id, input),
    onMutate: async ({ item }) => {
      await queryClient.cancelQueries({ queryKey: qk.review(pid) })
      const previous = queryClient.getQueryData<ReviewItem[]>(qk.review(pid))
      queryClient.setQueryData<ReviewItem[]>(qk.review(pid), (items) => items?.filter((i) => i.id !== item.id))
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(qk.review(pid), context.previous)
    },
    onSettled: (_data, _err, { item }) => {
      queryClient.invalidateQueries({ queryKey: qk.profile(pid) })
      queryClient.invalidateQueries({ queryKey: ["document", item.document_id] })
    },
  })
}
