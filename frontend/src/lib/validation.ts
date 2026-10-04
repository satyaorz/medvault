import { z } from "zod"

import { RELATIONSHIPS, SELECTABLE_DOC_TYPES, SEXES } from "@/lib/constants"

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Not a valid date")

/** Empty string or a valid ISO date (HTML date inputs produce "" when cleared). */
export const optionalIsoDate = z.union([z.literal(""), isoDate])

export const loginSchema = z.object({
  email: z.email("Enter a valid email address").trim(),
  password: z.string().min(1, "Enter your password"),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(100, "Keep it under 100 characters"),
    email: z.email("Enter a valid email address").trim(),
    password: z.string().min(8, "Use at least 8 characters").max(128, "Keep it under 128 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
export type RegisterValues = z.infer<typeof registerSchema>

export const profileSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(100, "Keep it under 100 characters"),
  relationship: z.enum(RELATIONSHIPS),
  date_of_birth: optionalIsoDate.refine((v) => !v || new Date(v) <= new Date(), "Date of birth can't be in the future"),
  sex: z.union([z.literal(""), z.enum(SEXES)]),
})
export type ProfileValues = z.infer<typeof profileSchema>

export const documentMetaSchema = z.object({
  title: z.string().trim().max(200, "Keep it under 200 characters"),
  doc_date: optionalIsoDate,
  doc_type: z.union([z.literal(""), z.enum(SELECTABLE_DOC_TYPES)]),
  source: z.string().trim().max(200, "Keep it under 200 characters"),
})
export type DocumentMetaValues = z.infer<typeof documentMetaSchema>
