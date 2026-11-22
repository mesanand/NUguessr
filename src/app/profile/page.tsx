"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser } from "../../../hooks/use-user";
import { SignOutButton } from "@/components/signout-button";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadMyName, saveMyName, NAME_MAX } from "@/lib/player";
import { useStartGame } from "@/components/game/use-start-game";
import { MainNav } from "@/components/main-nav";
import {
  MapPin,
  Edit2,
  Save,
  GamepadIcon,
  Star,
  BarChart2,
  Trophy,
  Loader2,
} from "lucide-react"
export default function ProfilePage() {
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const { user, loading: userLoading } = useUser();
  const supabaseClient = createClient();

  const [username, setUsername] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  // The leaderboard name lives in the users table (players don't sign in,
  // so there's usually no auth profile name).
  useEffect(() => {
    if (!user?.id) return;
    loadMyName(user.id).then((name) => setUsername(name ?? ""));
  }, [user?.id]);
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

  // Persist the edited leaderboard name.
  const saveUsername = async () => {
    if (!user?.id) return
    setIsSavingUsername(true)
    const problem = await saveMyName(user.id, username)
    setIsSavingUsername(false)
    setNameError(problem)
    if (!problem) {
      setUsername(username.trim())
      setIsEditingUsername(false)
    }
  }

  const navigateLeaderboard = () => {
    router.push("/leaderboards");
  };

  // Same server-recorded game start as the home page.
  const { start: startGame, pending: startingGame, error: startError } = useStartGame();

  const stats = [
    {
      label: "High score",
      icon: Star,
      value: highScore !== null ? highScore.toLocaleString() : null,
    },
    {
      label: "Average score",
      icon: BarChart2,
      value: avgScore !== null ? avgScore.toLocaleString() : null,
    },
    {
      label: "Games played",
      icon: GamepadIcon,
      value: gamesPlayed !== null ? gamesPlayed.toLocaleString() : null,
    },
  ]

  const avatarUrl: string | undefined = user?.user_metadata?.avatar_url
  const initial = (username || "?").trim().charAt(0).toUpperCase()

  // Nobody has to sign in: a visitor who hasn't played yet has no stats.
  if (!userLoading && !user) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <MainNav />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
          <h1 className="text-4xl uppercase">No stats yet</h1>
          <p className="text-base text-muted-foreground">
            Play a game and your scores will show up here.
          </p>
          <Button
            size="lg"
            className="h-12 rounded-md px-8 text-base font-semibold uppercase tracking-wide"
            onClick={startGame}
            disabled={startingGame}
            aria-busy={startingGame}
          >
            {startingGame && <Loader2 className="animate-spin" />}
            Play now
          </Button>
          {startError && (
            <p role="alert" className="text-sm text-destructive">
              {startError}
            </p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <MainNav />

      {/* Player card */}
      <header className="bg-ink text-ink-foreground">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20 ring-4 ring-primary">
              {avatarUrl && <AvatarImage src={avatarUrl} alt="Profile picture" />}
              <AvatarFallback className="bg-primary font-display text-3xl font-bold text-primary-foreground">
                {initial}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="sign-label text-ink-foreground/60">On the board as</p>
              {isEditingUsername ? (
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-label="Leaderboard name"
                    maxLength={NAME_MAX}
                    placeholder="Pick a name"
                    className="h-11 max-w-[220px] rounded-md bg-card text-foreground"
                  />
                  <Button
                    size="icon"
                    onClick={saveUsername}
                    disabled={isSavingUsername}
                    aria-label="Save username"
                    className="min-h-11 min-w-11 rounded-md"
                  >
                    <Save className="h-5 w-5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <h1 className="truncate text-4xl uppercase">{username || "No name yet"}</h1>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setIsEditingUsername(true)}
                    aria-label="Edit username"
                    className="min-h-11 min-w-11 rounded-md text-ink-foreground/70 hover:bg-ink-foreground/10 hover:text-ink-foreground"
                  >
                    <Edit2 className="h-5 w-5" />
                  </Button>
                </div>
              )}
              {nameError && (
                <p role="alert" className="mt-1 text-sm text-secondary">
                  {nameError}
                </p>
              )}
            </div>
          </div>
          {/* Anonymous players would lose their stats by signing out. */}
          {user && !user.is_anonymous && <SignOutButton />}
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        {/* Stats */}
        <section aria-labelledby="stats-heading">
          <h2 id="stats-heading" className="text-2xl uppercase">
            Your stats
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {stats.map(({ label, icon: Icon, value }) => (
              <div key={label} className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <p className="sign-label">{label}</p>
                  <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
                {value !== null ? (
                  <p className="mt-2 font-mono text-4xl font-semibold tabular-nums">{value}</p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Actions */}
        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            size="lg"
            className="h-12 w-full rounded-md text-base font-semibold uppercase tracking-wide"
            onClick={startGame}
            disabled={startingGame}
            aria-busy={startingGame}
          >
            {startingGame ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <MapPin className="mr-2 h-5 w-5" />
            )}{" "}
            Play
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-12 w-full rounded-md text-base font-semibold"
            onClick={navigateLeaderboard}
          >
            <Trophy className="mr-2 h-5 w-5" /> Leaderboards
          </Button>
        </div>
        {startError && (
          <p role="alert" className="mt-3 text-center text-sm text-destructive">
            {startError}
          </p>
        )}
      </main>
    </div>
  );
}
