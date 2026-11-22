import { Button } from "@/components/ui/button"
import { useUser } from "../../hooks/use-user"
import { createClient } from "@/lib/supabase/client"
import { toast } from "@/hooks/use-toast"
import { Icons } from "@/components/icons"
import { Suspense, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { ProfileImage } from "./profile-image"

// useSearchParams() opts the component into client-side rendering during
// static generation, so Next.js requires a Suspense boundary around any
// component that calls it. Wrapping here means every call site of
// <SignInButton /> gets this for free.
export function SignInButton() {
  return (
    <Suspense
      fallback={
        <Button
          className="h-11 rounded-md px-5 text-base font-semibold"
          type="button"
          disabled
        >
          <Icons.loaderCircle className="animate-spin" /> Log in
        </Button>
      }
    >
      <SignInButtonInner />
    </Suspense>
  )
}

function SignInButtonInner() {
    const { user } = useUser()
    const [isGoogleLoading, setIsGoogleLoading] = useState<boolean>(false)
    const supabase = createClient()
    const router = useRouter()
    const searchParams = useSearchParams()
    const next = searchParams.get("next")
   
    async function signInWithGoogle() {
      setIsGoogleLoading(true)
      try {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback${
              next ? `?next=${encodeURIComponent(next)}` : ""
            }`,
          },
        })
   
        if (error) {
          throw error
        }
      } catch {
        toast({
          title: "Please try again.",
          description: "There was an error logging in with Google.",
          variant: "destructive",
        })
        setIsGoogleLoading(false)
      }
    }
    const handleButtonClick = () => {
      if (user?.email) {
        router.push("/profile")
      } 
      else {
        signInWithGoogle()
      }
    }

    return (
      <Button
        className="h-11 rounded-md px-5 text-base font-semibold"
        type="button"
        onClick={handleButtonClick}
        disabled={isGoogleLoading}
        aria-busy={isGoogleLoading}
      >
        {isGoogleLoading ? (
          <Icons.loaderCircle className="animate-spin" />
        ) : (
          <ProfileImage />
        )}
        {user?.email ? "Profile" : "Log in"}
      </Button>
      )
}