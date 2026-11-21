import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { cleanText, safeHttpUrl, sourceLabel } from "@/components/game/credit-utils"

// Attribution for every live photo. Deliberately lists only author, license
// and source link — no place names, coordinates or thumbnails — so it can't
// be used as an answer key. photo_credits() returns rows in random order.

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Photo credits · NUGuessr",
}

type CreditRow = {
  author: string | null
  license: string | null
  source: string | null
  source_url: string | null
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
      <main className="container mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <header className="mb-8 space-y-2">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-lg text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            &larr; Back to NUGuessr
          </Link>
          <h1 className="text-4xl font-bold tracking-tight">Photo credits</h1>
          <p className="text-base text-muted-foreground">
            NUGuessr&apos;s campus photos come from Wikimedia Commons, Mapillary and our own
            contributors, and are used under their original licenses. Thank you to everyone who
            shares their photos. Follow a source link for the full license and original file.
          </p>
        </header>

        <Card className="rounded-2xl border-border bg-card shadow-sm">
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
                  const license = cleanText(row.license)
                  const label = sourceLabel(row.source)
                  const sourceText = label ? `via ${label}` : "Source"
                  const href = safeHttpUrl(row.source_url)
                  return (
                    <li
                      key={i}
                      className="flex flex-col gap-1 px-4 py-3 even:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-medium">{author}</p>
                        {license && <p className="text-sm text-muted-foreground">{license}</p>}
                      </div>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 shrink-0 items-center text-sm font-medium text-foreground underline underline-offset-2 hover:text-primary"
                        >
                          {sourceText}
                        </a>
                      ) : (
                        label && <span className="shrink-0 text-sm text-muted-foreground">{sourceText}</span>
                      )}
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
