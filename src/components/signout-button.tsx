"use client"

import { useRouter } from "next/navigation"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Icons } from "@/components/icons"

export function SignOutButton() {
  const supabase = createClient()
  const router = useRouter()

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push("/")
    router.refresh()
  }

  return (
    <Button
      variant="outline"
      className="h-11 w-full rounded-md sm:w-auto"
      onClick={handleLogout}
    >
      <Icons.logOut />
      Sign out
    </Button>
  )
}
