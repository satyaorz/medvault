import { redirect } from "next/navigation"

export default async function ProfileIndex({ params }: PageProps<"/p/[profileId]">) {
  const { profileId } = await params
  redirect(`/p/${profileId}/dashboard`)
}
