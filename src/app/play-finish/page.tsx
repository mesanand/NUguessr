"use client"

import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { RotateCcw } from "lucide-react"
import { SignInButton } from "@/components/signin-button"
import { useState, useEffect, useMemo } from "react"
import { useUser } from "../../../hooks/use-user"

const MAX_POSSIBLE_SCORE = 25000 // Maximum possible score for reference

export default function PlayFinishPage() {
  const [finalScore, setFinalScore] = useState(0)
  const router = useRouter()
  const { user } = useUser()

  // On mount, read the accumulated final score from local storage.
  useEffect(() => {
    const storedScore = Number(localStorage.getItem("finalScore") || "0")
    setFinalScore(storedScore)
  }, [])

  const scorePercentage = (finalScore / MAX_POSSIBLE_SCORE) * 100

  // Generate a random round with 5 unique campus-location ids (1-55).
  const randomLink = useMemo(() => {
    const numbers = Array.from({ length: 55 }, (_, i) => i + 1)
    for (let i = numbers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[numbers[i], numbers[j]] = [numbers[j], numbers[i]]
    }
    const fiveNumbers = numbers.slice(0, 5)
    return `/play/${fiveNumbers.join("-")}`
  }, [])

  const resetGame = () => {
    localStorage.removeItem("score")
    localStorage.removeItem("processedRound")
    localStorage.removeItem("finalScore")
  }

  const handlePlayAgain = () => {
    resetGame()
    router.push(randomLink)
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <main className="flex-1 container mx-auto flex flex-col items-center justify-center gap-6 px-4 py-8">
        <Card className="w-full max-w-2xl rounded-2xl border-border shadow-sm">
          <CardContent className="space-y-6 p-6 text-center sm:p-10">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Game finished</p>
              <h1 className="text-4xl font-bold tracking-tight">Well done!</h1>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Your total score</p>
              <p className="text-4xl font-bold tracking-tight text-primary tabular-nums">
                {finalScore.toLocaleString()}
                <span className="ml-2 text-base font-medium text-muted-foreground">
                  / {MAX_POSSIBLE_SCORE.toLocaleString()} points
                </span>
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between px-1 text-sm text-muted-foreground">
                <span>Score</span>
                <span className="tabular-nums">{scorePercentage.toFixed(1)}%</span>
              </div>
              <Progress value={scorePercentage} className="h-2" />
            </div>
            {!user?.email && (
              <p className="text-base text-muted-foreground">Log in to save your score!</p>
            )}
          </CardContent>
        </Card>

        <div className="flex w-full max-w-2xl flex-col gap-4 sm:flex-row sm:items-center">
          <Button
            className="h-12 flex-1 rounded-lg text-base font-semibold"
            onClick={handlePlayAgain}
          >
            <RotateCcw />
            Play again
          </Button>
          <SignInButton />
        </div>
      </main>
    </div>
  )
}
