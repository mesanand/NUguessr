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

  const getRankColor = (rank: number) => {
    switch (rank) {
      case 1:
        return "text-yellow-500"
      case 2:
        return "text-gray-400"
      case 3:
        return "text-amber-700"
      default:
        return "text-gray-600"
    }
  }

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="h-5 w-5 text-yellow-500" />
      case 2:
        return <Medal className="h-5 w-5 text-gray-400" />
      case 3:
        return <Medal className="h-5 w-5 text-amber-700" />
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
    <div className="min-h-screen bg-white">
      <header className="w-full bg-[#D41B2C] p-4 text-center shadow-md">
        <h1 className="text-4xl font-bold text-white">All-Time Leaderboards</h1>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card className="shadow-xl">
          <CardHeader className="pb-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-2xl font-bold">Top Players</CardTitle>
              <div className="flex flex-col gap-4 md:flex-row md:items-center">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search players..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[180px]">
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
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground text-center py-8">Loading leaderboard...</p>
            ) : error ? (
              <p className="text-red-600 text-center py-8">Couldn&apos;t load the leaderboard: {error}</p>
            ) : filteredData.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No scores yet — be the first to play!
              </p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Rank</TableHead>
                      <TableHead>Player</TableHead>
                      <TableHead className="text-right">High Score</TableHead>
                      <TableHead className="text-right">Games Played</TableHead>
                      <TableHead className="text-right">Avg Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredData.map((player) => (
                      <TableRow key={player.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {getRankIcon(player.rank)}
                            <span className={getRankColor(player.rank)}>#{player.rank}</span>
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold">{player.username}</TableCell>
                        <TableCell className="text-right">{player.high_score.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{player.total_games}</TableCell>
                        <TableCell className="text-right">{player.avg_score.toLocaleString()}</TableCell>
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
