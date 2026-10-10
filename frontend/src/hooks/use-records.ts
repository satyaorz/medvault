"use client"

import { useQuery } from "@tanstack/react-query"

import { api } from "@/lib/api"
import { qk } from "@/lib/query-keys"

export function useTimeline(pid: string) {
  return useQuery({ queryKey: qk.timeline(pid), queryFn: () => api.timeline(pid) })
}

export function useLabs(pid: string) {
  return useQuery({ queryKey: qk.labs(pid), queryFn: () => api.labs.list(pid) })
}

export function useLabSeries(pid: string, code: string) {
  return useQuery({ queryKey: qk.labSeries(pid, code), queryFn: () => api.labs.series(pid, code) })
}

export function useMedications(pid: string) {
  return useQuery({ queryKey: qk.medications(pid), queryFn: () => api.medications(pid) })
}
