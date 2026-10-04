"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import { api } from "@/lib/api"
import { qk } from "@/lib/query-keys"

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.auth.me(),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.auth.login,
    onSuccess: (user) => {
      queryClient.clear()
      queryClient.setQueryData(qk.me, user)
    },
  })
}

export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.auth.register,
    onSuccess: (user) => {
      queryClient.clear()
      queryClient.setQueryData(qk.me, user)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: api.auth.logout,
    onSettled: () => {
      queryClient.clear()
      router.replace("/login")
    },
  })
}
