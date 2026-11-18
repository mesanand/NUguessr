import { createClient } from "@/lib/supabase/client"

/**
 * Persists a finished game's score to the signed-in user's stats row.
 *
 * This used to live inside src/app/play-finish/page.tsx as a named export
 * called `updateHighScore`. Two problems with that: (1) it called
 * useState/useEffect directly inside a plain async function, which breaks
 * the Rules of Hooks and would have thrown if it were ever actually called
 * (it wasn't — the one call site had it commented out); and (2) a page.tsx
 * file in the App Router may only export `default`/`metadata`/a small
 * fixed set of names, so a stray named export there fails `next build`'s
 * type-checking outright. Moving it to a plain lib module fixes both.
 *
 * Also fixes the original logic bugs: it now writes to `high_score`
 * (the original wrote into `total_games` by mistake) and takes the max of
 * the existing and new score. It also maintains a running `avg_score`,
 * which nothing previously computed at all.
 */
export async function updateUserStats(finalScore: number) {
  const supabaseClient = createClient()
  const { data: userData, error: userError } = await supabaseClient.auth.getUser()

  if (userError || !userData?.user) {
    // Not signed in — nothing to persist. The UI already prompts guests to log in.
    return
  }

  const userId = userData.user.id

  const { data: userRecord, error: fetchError } = await supabaseClient
    .from("users")
    .select("total_games, high_score, avg_score")
    .eq("id", userId)
    .single()

  if (fetchError || !userRecord) {
    const { error: insertError } = await supabaseClient.from("users").insert([
      {
        id: userId,
        total_games: 1,
        high_score: finalScore,
        avg_score: finalScore,
      },
    ])
    if (insertError) {
      console.error("Error inserting new user stats:", insertError)
    }
    return
  }

  const previousGames = userRecord.total_games ?? 0
  const previousHigh = userRecord.high_score ?? 0
  const previousAvg = userRecord.avg_score ?? 0

  const newTotalGames = previousGames + 1
  const newHighScore = Math.max(previousHigh, finalScore)
  const newAvgScore = Math.round((previousAvg * previousGames + finalScore) / newTotalGames)

  const { error: updateError } = await supabaseClient
    .from("users")
    .update({
      total_games: newTotalGames,
      high_score: newHighScore,
      avg_score: newAvgScore,
    })
    .eq("id", userId)

  if (updateError) {
    console.error("Error updating user stats:", updateError)
  }
}
