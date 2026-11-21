import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight, Images } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { checkAdmin } from "@/lib/require-admin"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const admin = await checkAdmin()
  if (!admin.ok) {
    redirect(admin.reason === "unauthenticated" ? "/signin?next=/admin" : "/")
  }
  const { supabase } = admin

  const { data: users, error } = await supabase
    .from("users")
    .select("id, email, role")
    .order("email", { ascending: true })

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">Admin</h1>

      <Link href="/admin/curate" className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Card className="transition-colors group-hover:bg-muted">
          <CardContent className="flex min-h-11 items-center gap-4 p-4">
            <Images className="size-6 shrink-0 text-primary" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-semibold">Curate photos</p>
              <p className="text-sm text-muted-foreground">Review candidates, fix pins, publish places.</p>
            </div>
            <ArrowRight className="size-5 text-muted-foreground" aria-hidden="true" />
          </CardContent>
        </Card>
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>Accounts visible to your session.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">Error loading users: {error.message}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(users ?? []).map(({ id, email, role }) => (
                <li key={id} className="flex items-center justify-between gap-4 py-2">
                  <span className="truncate">{email ?? "(no email)"}</span>
                  <span className="shrink-0 rounded-lg bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
