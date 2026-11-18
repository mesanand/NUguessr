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
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <main className="flex-1 container mx-auto px-4 flex flex-col items-center justify-center gap-4 py-4">
        <Card className="w-full max-w-2xl shadow-xl">
          <CardContent className="py-10 text-center space-y-6">
            <h1 className="text-4xl font-bold text-primary">Game finished, well done!</h1>
            <p className="text-2xl text-muted-foreground">
              Your total score was{" "}
              <span className="font-bold text-primary">{finalScore.toLocaleString()}</span> points
            </p>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground px-1">
                <span>Score</span>
                <span>{scorePercentage.toFixed(1)}%</span>
              </div>
              <Progress value={scorePercentage} className="h-2" />
            </div>
            {!user?.email && (
              <p className="text-lg text-muted-foreground">Log in to save your score!</p>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-2xl">
          <Button
            variant="outline"
            className="flex-1 h-12 text-2xl font-bold border-2 border-primary text-primary hover:bg-primary hover:text-white"
            onClick={handlePlayAgain}
          >
            <RotateCcw className="mr-2 h-5 w-5" />
            Play Again
          </Button>
          <SignInButton />
        </div>
      </main>
    </div>
  )
}
