"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser } from "../../../hooks/use-user";
import { SignOutButton } from "@/components/signout-button";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Image from "next/image";
import {
  MapPin,
  Edit2,
  Save,
  GamepadIcon,
  Star,
  BarChart2,
  Trophy,
} from "lucide-react"
export default function ProfilePage() {
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const { user } = useUser();  // Assuming `useUser` hook fetches authenticated user data
  const supabaseClient = createClient();

  const [username, setUsername] = useState(user?.user_metadata?.name || "");

  // Keep the field in sync once the user object actually loads (it starts
  // out null on first render, so the initial useState value above is often "").
  useEffect(() => {
    if (user?.user_metadata?.name) {
      setUsername(user.user_metadata.name);
    }
  }, [user?.user_metadata?.name]);
  const [gamesPlayed, setGamesPlayed] = useState<number | null>(null);  // Initialize as null
  const [highScore, setHighScore] = useState<number | null>(null);  // Initialize as null
  const [avgScore, setAvgScore] = useState<number | null>(null);  // Initialize as null
  const router = useRouter();

  // Fetch the user's total games from the database
  useEffect(() => {
    if (user?.id) {
      const fetchTotalGames = async () => {
        const { data, error } = await supabaseClient
          .from("users")
          .select("total_games")
          .eq("id", user.id)
          .single();

        if (error) {
          console.error("Error fetching total games:", error);
        } else {
          setGamesPlayed(data?.total_games ?? 0);  // Default to 0 if no total_games is found
        }
      }
      const fetchHighScore = async () => {
        const { data, error } = await supabaseClient
          .from("users")
          .select("high_score")
          .eq("id", user.id)
          .single();

        if (error) {
          console.error("Error fetching total games:", error);
        } else {
          setHighScore(data?.high_score ?? 0);  // Default to 0 if no high is found
        }
      }
      const fetchAvgScore = async () => {
        const { data, error } = await supabaseClient
          .from("users")
          .select("avg_score")
          .eq("id", user.id)
          .single();

        if (error) {
          console.error("Error fetching total games:", error);
        } else {
          setAvgScore(data?.avg_score ?? 0);  // Default to 0 if no avg is found
        }
      };

      fetchTotalGames();
      fetchHighScore();
      fetchAvgScore();
    }
  }, [user?.id, supabaseClient]);  // Only run when user changes or user.id is available

  // Generate a random link with 5 unique random numbers (between 1 and 55)
  const randomLink = useMemo(() => {
    // Create an array of numbers from 1 to 55.
    const numbers = Array.from({ length: 55 }, (_, i) => i + 1)
    // Shuffle the numbers using the Fisher-Yates algorithm.
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[numbers[i], numbers[j]] = [numbers[j], numbers[i]]
    }
    // Take the first 5 numbers and join them with a hyphen.
    const fiveNumbers = numbers.slice(0, 5)
    return `/play/${fiveNumbers.join("-")}`
  }, [])

  // Persist the edited username. The original version only toggled local
  // state here and never actually wrote anywhere, so edits vanished on refresh.
  const saveUsername = async () => {
    if (!user?.id) return
    setIsSavingUsername(true)
    try {
      const [{ error: authError }, { error: dbError }] = await Promise.all([
        supabaseClient.auth.updateUser({ data: { name: username } }),
        supabaseClient.from("users").update({ username }).eq("id", user.id),
      ])
      if (authError) console.error("Error updating auth profile:", authError)
      if (dbError) console.error("Error updating username in users table:", dbError)
    } finally {
      setIsSavingUsername(false)
      setIsEditingUsername(false)
    }
  }

  const navigateLeaderboard = () => {
    router.push("/leaderboards");
  };

  const navigatePlay = () => {
    router.push(randomLink);
  };

  const stats = [
    {
      label: "High Score",
      icon: Star,
      value: highScore !== null ? highScore.toLocaleString() : null,
    },
    {
      label: "Average Score",
      icon: BarChart2,
      value: avgScore !== null ? avgScore.toLocaleString() : null,
    },
    {
      label: "Games Played",
      icon: GamepadIcon,
      value: gamesPlayed !== null ? gamesPlayed.toLocaleString() : null,
    },
  ]

  const avatarUrl: string | undefined = user?.user_metadata?.avatar_url
  const initial = (username || "?").trim().charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="container mx-auto max-w-4xl px-4 py-8 sm:py-12">
        <div className="mb-8 flex justify-center">
          <Image
            src="/logo.png"
            alt="NUGuessr Logo"
            width={240}
            height={400}
            className="h-auto w-48 sm:w-60"
            priority
          />
        </div>

        {/* Profile header */}
        <Card className="rounded-2xl border-border bg-card shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 p-6 sm:flex-row sm:justify-between">
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <Avatar className="h-20 w-20">
                {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile picture" />}
                <AvatarFallback className="bg-secondary text-2xl font-bold text-secondary-foreground">
                  {initial}
                </AvatarFallback>
              </Avatar>
              {isEditingUsername ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-label="Username"
                    className="h-11 max-w-[220px] rounded-lg"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={saveUsername}
                    disabled={isSavingUsername}
                    aria-label="Save username"
                    className="min-h-11 min-w-11 rounded-lg text-primary hover:bg-secondary hover:text-secondary-foreground"
                  >
                    <Save className="h-5 w-5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold">{username}</h1>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setIsEditingUsername(true)}
                    aria-label="Edit username"
                    className="min-h-11 min-w-11 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Edit2 className="h-5 w-5" />
                  </Button>
                </div>
              )}
            </div>
            <SignOutButton />
          </CardContent>
        </Card>

        {/* Stats */}
        <section aria-labelledby="stats-heading" className="mt-8">
          <h2 id="stats-heading" className="mb-4 text-xl font-semibold">
            Your stats
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {stats.map(({ label, icon: Icon, value }) => (
              <Card key={label} className="rounded-2xl border-border bg-card shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </CardHeader>
                <CardContent className="p-6 pt-0">
                  {value !== null ? (
                    <p className="text-4xl font-bold tracking-tight">{value}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Actions */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Button
            size="lg"
            className="h-12 w-full rounded-lg text-base font-semibold"
            onClick={navigatePlay}
          >
            <MapPin className="mr-2 h-5 w-5" /> Play
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-12 w-full rounded-lg text-base font-semibold"
            onClick={navigateLeaderboard}
          >
            <Trophy className="mr-2 h-5 w-5" /> Leaderboards
          </Button>
        </div>
      </main>
    </div>
  );
}
