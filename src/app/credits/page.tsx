import Link from "next/link"
import { MainNav } from "@/components/main-nav"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { cleanText, isContributed, sourceHomeUrl, sourceLabel } from "@/components/game/credit-utils"
import { LicenseText } from "@/components/game/photo-credit"

// Attribution for every live photo. Deliberately lists only author, license
// and source site — no place names, coordinates, thumbnails or per-file links
// (Commons file names often name the building) — so it can't be used as an
// answer key. photo_credits() returns rows in random order.

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Photo credits · NUGuessr",
}

type CreditRow = {
  author: string | null
  license: string | null
  source: string | null
}

export default async function CreditsPage() {
  let rows: CreditRow[] = []
  let failed = false
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc("photo_credits")
    if (error) failed = true
    else rows = (data ?? []) as CreditRow[]
  } catch {
    failed = true
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <MainNav />
      <main className="container mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <header className="mb-8 space-y-2">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-lg text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            &larr; Back to NUGuessr
          </Link>
          <h1 className="text-4xl uppercase sm:text-5xl">Photo credits</h1>
          <p className="text-base text-muted-foreground">
            NUGuessr&apos;s campus photos come from Wikimedia Commons, Mapillary and our own
            contributors, and are used under their original licenses. Thank you to everyone who
            shares their photos. Follow a license link for its full terms.
          </p>
          <p className="text-base text-muted-foreground">
            Each photo&apos;s original file is linked on the results screen right after you guess it.
          </p>
        </header>

        <Card className="rounded-lg border-border bg-card">
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-2xl font-bold">
              {rows.length > 0 ? `${rows.length} ${rows.length === 1 ? "photo" : "photos"}` : "Photos"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {failed ? (
              <p className="py-8 text-center text-sm text-destructive">
                Couldn&apos;t load photo credits right now. Please try again later.
              </p>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No campus photos are live yet.
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {rows.map((row, i) => {
                  const author = cleanText(row.author) ?? "Unknown author"
                  const hasLicense = cleanText(row.license) !== null
                  const label = isContributed(row.source) ? null : sourceLabel(row.source)
                  const home = sourceHomeUrl(row.source)
                  return (
                    <li
                      key={i}
                      className="flex flex-col gap-1 px-4 py-3 even:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium">{author}</p>
                        {hasLicense && (
                          <p className="text-sm text-muted-foreground">
                            <LicenseText license={row.license} />
                          </p>
                        )}
                      </div>
                      {label &&
                        (home ? (
                          <a
                            href={home}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-foreground underline underline-offset-2 hover:text-primary"
                          >
                            {label}
                          </a>
                        ) : (
                          <span className="inline-flex min-h-11 shrink-0 items-center text-sm text-muted-foreground">
                            {label}
                          </span>
                        ))}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
