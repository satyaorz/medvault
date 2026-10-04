"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { POLL_INTERVAL_MS } from "@/lib/constants"
import { qk } from "@/lib/query-keys"
import type { ProfileInput } from "@/lib/types"

export function useProfiles() {
  return useQuery({ queryKey: qk.profiles, queryFn: api.profiles.list })
}

export function useCreateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ProfileInput) => api.profiles.create(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.profiles }),
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ProfileInput> }) => api.profiles.update(id, input),
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: qk.profiles })
      queryClient.invalidateQueries({ queryKey: qk.summary(profile.id) })
    },
  })
}

export function useDeleteProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.profiles.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: qk.profile(id) })
      queryClient.invalidateQueries({ queryKey: qk.profiles })
    },
  })
}

export function useSummary(pid: string) {
  return useQuery({
    queryKey: qk.summary(pid),
    queryFn: () => api.profiles.summary(pid),
    refetchInterval: (query) => ((query.state.data?.counts.processing ?? 0) > 0 ? POLL_INTERVAL_MS : false),
  })
}
