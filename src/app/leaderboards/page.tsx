"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Trophy, Medal, Search } from "lucide-react"
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
        setError(error.message)
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

  // Top three get the brand accent; everyone else stays neutral.
  const getRankColor = (rank: number) =>
    rank <= 3 ? "text-primary font-semibold" : "text-muted-foreground"

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="h-4 w-4 text-primary" aria-hidden="true" />
      case 2:
      case 3:
        return <Medal className="h-4 w-4 text-primary" aria-hidden="true" />
      default:
        return null
    }
  }

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
    <div className="min-h-screen bg-background text-foreground">
      <main className="container mx-auto max-w-5xl px-4 py-8 sm:py-12">
        <header className="mb-8">
          <h1 className="text-4xl font-bold tracking-tight">All-Time Leaderboards</h1>
          <p className="mt-2 text-sm text-muted-foreground">Top 100 NUGuessr players.</p>
        </header>

        <Card className="rounded-2xl border-border bg-card shadow-sm">
          <CardHeader className="p-4 sm:p-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-2xl font-bold">Top Players</CardTitle>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-64">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    placeholder="Search players..."
                    aria-label="Search players"
                    className="h-11 rounded-lg bg-background pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="h-11 w-full rounded-lg bg-background sm:w-[180px]" aria-label="Sort by">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high_score">High Score</SelectItem>
                    <SelectItem value="total_games">Games Played</SelectItem>
                    <SelectItem value="avg_score">Average Score</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Loading leaderboard...</p>
            ) : error ? (
              <p className="py-8 text-center text-sm text-destructive">Couldn&apos;t load the leaderboard: {error}</p>
            ) : filteredData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No scores yet — be the first to play!
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <Table className="min-w-[520px]">
                  <TableHeader>
                    <TableRow className="border-border bg-muted hover:bg-muted">
                      <TableHead className="w-20 text-muted-foreground">Rank</TableHead>
                      <TableHead className="text-muted-foreground">Player</TableHead>
                      <TableHead className="text-right text-muted-foreground">High Score</TableHead>
                      <TableHead className="text-right text-muted-foreground">Games</TableHead>
                      <TableHead className="text-right text-muted-foreground">Avg Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredData.map((player) => (
                      <TableRow
                        key={player.id}
                        className="border-border even:bg-muted/50 hover:bg-secondary/60"
                      >
                        <TableCell className="py-3">
                          <div className="flex items-center gap-2 tabular-nums">
                            {getRankIcon(player.rank)}
                            <span className={getRankColor(player.rank)}>#{player.rank}</span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate py-3 font-medium">{player.username}</TableCell>
                        <TableCell className="py-3 text-right font-semibold tabular-nums">
                          {player.high_score.toLocaleString()}
                        </TableCell>
                        <TableCell className="py-3 text-right tabular-nums">{player.total_games}</TableCell>
                        <TableCell className="py-3 text-right tabular-nums">
                          {player.avg_score.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
