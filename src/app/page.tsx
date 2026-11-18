"use client";

import Link from "next/link";
import Image from "next/image";
import "@fontsource/open-sans";
import "@fontsource/titillium-web";
import { useRouter } from "next/navigation";
import { MainNav } from "@/components/main-nav";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import { PLACE_COUNT } from "@/lib/places";

const steps = [
  {
    title: "See a spot",
    body: "You get five photos taken somewhere on the Northeastern campus.",
  },
  {
    title: "Drop a pin",
    body: "Mark on the map where you think each photo was taken.",
  },
  {
    title: "Score points",
    body: "The closer your guess, the higher your score.",
  },
];

// Generate a random link with 5 unique random numbers (between 1 and PLACE_COUNT).
// Called on click, not during render: Math.random() during render produced a
// different link on the server than on the client (hydration mismatch).
function makeRandomLink() {
  // Create an array of numbers from 1 to PLACE_COUNT.
  const numbers = Array.from({ length: PLACE_COUNT }, (_, i) => i + 1);
  // Shuffle the numbers using the Fisher-Yates algorithm.
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  // Take the first 5 numbers and join them with a hyphen.
  const fiveNumbers = numbers.slice(0, 5);
  return `/play/${fiveNumbers.join("-")}`;
}

export default function HomePage() {
  const router = useRouter();

  // Function to reset game-related localStorage values.
  const resetGame = () => {
    localStorage.removeItem("score");
    localStorage.removeItem("processedRound");
    localStorage.removeItem("finalScore");
  };

  const startGame = () => {
    resetGame();
    router.push(makeRandomLink());
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <MainNav />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:py-16">
        <section className="grid items-center gap-10 md:grid-cols-2">
          <div className="flex flex-col items-start gap-6">
            <Image
              src="/logo.png"
              alt="NUGuessr — Navigate NEU like a pro"
              width={562}
              height={458}
              className="h-auto w-36 md:w-44"
              priority
            />
            <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">
              <Icons.mapPin className="size-4" aria-hidden="true" />
              A campus geography game
            </span>
            <div className="space-y-3">
              <h1 className="text-4xl font-bold tracking-tight">
                Think you know your school well?
              </h1>
              <p className="text-base text-muted-foreground">
                Want to familiarize yourself with the campus? Guess where each
                photo was taken and see how well you really know Northeastern.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button
                type="button"
                size="lg"
                onClick={startGame}
                className="h-12 rounded-lg px-8 text-base font-semibold"
              >
                Test your skills!
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 rounded-lg px-6 text-base"
              >
                <Link href="/leaderboards">
                  <Icons.trophy aria-hidden="true" />
                  Leaderboards
                </Link>
              </Button>
            </div>
          </div>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-muted shadow-sm">
            <Image
              src="/background.jpg"
              alt="Northeastern University campus"
              fill
              sizes="(min-width: 768px) 480px, 100vw"
              className="object-cover"
              priority
            />
          </div>
        </section>

        <section aria-labelledby="how-it-works" className="mt-16">
          <h2 id="how-it-works" className="text-2xl font-bold">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {steps.map((step, i) => (
              <li
                key={step.title}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-xl font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
