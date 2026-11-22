"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { MainNav } from "@/components/main-nav"
import { useStartGame } from "@/components/game/use-start-game"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Search } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

type LeaderboardRow = {
  id: string
  username: string
  high_score: number
  total_games: number
  avg_score: number
}

export default function LeaderboardsPage() {
  const [sortBy, setSortBy] = useState("high_score")
  const [searchQuery, setSearchQuery] = useState("")
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Pulls real standings from the `users` table. The original version of
  // this page never queried Supabase at all — it rendered a hardcoded
  // array of fake names and scores regardless of who had actually played.
  useEffect(() => {
    async function fetchLeaderboard() {
      const supabase = createClient()
      // Reads from a view rather than the `users` table directly, so a
      // public/anon leaderboard query can never surface email or role.
      const { data, error } = await supabase
        .from("leaderboard_public")
        .select("id, username, high_score, total_games, avg_score")
        .order("high_score", { ascending: false })
        .limit(100)

      if (error) {
        setError("Couldn't load the leaderboard. Try again in a minute.")
      } else {
        setRows(
          (data ?? []).map((row) => ({
            id: row.id,
            username: row.username || "Anonymous Husky",
            high_score: row.high_score ?? 0,
            total_games: row.total_games ?? 0,
            avg_score: row.avg_score ?? 0,
          }))
        )
      }
      setLoading(false)
    }
    fetchLeaderboard()
  }, [])

  const filteredData = rows
    .filter((player) => player.username.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      switch (sortBy) {
        case "total_games":
          return b.total_games - a.total_games
        case "avg_score":
          return b.avg_score - a.avg_score
        default:
          return b.high_score - a.high_score
      }
    })
    .map((player, index) => ({ ...player, rank: index + 1 }))

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MainNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-12">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="h-1 w-12 bg-primary" aria-hidden="true" />
            <h1 className="mt-3 text-4xl uppercase sm:text-5xl">Leaderboards</h1>
            <p className="mt-1 text-sm text-muted-foreground">Top 100 NUGuessr players, all time.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                placeholder="Search players"
                aria-label="Search players"
                className="h-11 rounded-md bg-card pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="h-11 w-full rounded-md bg-card sm:w-[180px]" aria-label="Sort by">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high_score">High score</SelectItem>
                <SelectItem value="total_games">Games played</SelectItem>
                <SelectItem value="avg_score">Average score</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </header>

        {/* Departures board */}
        <section aria-label="Top players" className="overflow-hidden rounded-lg bg-ink text-ink-foreground">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-12 font-mono text-sm text-ink-foreground/70">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading board...
            </p>
          ) : error ? (
            <p role="alert" className="py-12 text-center font-mono text-sm text-ink-foreground/80">
              {error}
            </p>
          ) : filteredData.length === 0 ? (
            <EmptyBoard searching={searchQuery.trim() !== ""} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] font-mono text-sm">
                <thead>
                  <tr className="border-b border-ink-foreground/15 text-left">
                    <th scope="col" className="sign-label w-16 px-4 py-3 text-ink-foreground/60">Rank</th>
                    <th scope="col" className="sign-label px-4 py-3 text-ink-foreground/60">Player</th>
                    <th scope="col" className="sign-label px-4 py-3 text-right text-ink-foreground/60">High score</th>
                    <th scope="col" className="sign-label px-4 py-3 text-right text-ink-foreground/60">Games</th>
                    <th scope="col" className="sign-label px-4 py-3 text-right text-ink-foreground/60">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((player) => {
                    const top = player.rank <= 3
                    return (
                      <tr
                        key={player.id}
                        className="border-b border-ink-foreground/10 last:border-0 hover:bg-ink-foreground/5"
                      >
                        <td className="px-4 py-3 tabular-nums">
                          <span
                            className={cn(
                              "inline-flex size-7 items-center justify-center rounded-sm text-xs font-semibold",
                              top ? "bg-primary text-primary-foreground" : "text-ink-foreground/60"
                            )}
                          >
                            {player.rank}
                          </span>
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 font-sans text-base font-medium">
                          {player.username}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right text-base font-semibold tabular-nums",
                            top && "text-secondary"
                          )}
                        >
                          {player.high_score.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-foreground/80">
                          {player.total_games}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink-foreground/80">
                          {player.avg_score.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function EmptyBoard({ searching }: { searching: boolean }) {
  const { start, pending, error } = useStartGame()
  if (searching) {
    return <p className="py-12 text-center font-mono text-sm text-ink-foreground/70">No players match that name.</p>
  }
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-12 text-center">
      <p className="font-display text-3xl font-bold uppercase tracking-wide">Board&apos;s empty</p>
      <p className="max-w-sm text-base text-ink-foreground/75">
        Log in and finish a game to put the first name up here.
      </p>
      <Button
        type="button"
        onClick={start}
        disabled={pending}
        aria-busy={pending}
        className="h-12 rounded-md px-8 text-base font-semibold uppercase tracking-wide"
      >
        {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
        Play now
      </Button>
      {error && (
        <p role="alert" className="text-sm text-ink-foreground/80">
          {error}
        </p>
      )}
    </div>
  )
}
