"use client";

import Link from "next/link";
import Image from "next/image";
import "@fontsource/open-sans";
import "@fontsource/titillium-web";
import { Loader2 } from "lucide-react";
import { MainNav } from "@/components/main-nav";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import { useStartGame } from "@/components/game/use-start-game";

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

export default function HomePage() {
  // Games are created on the server (start_game RPC); the URL is just the
  // game id, so it reveals nothing about the rounds.
  const { start, pending, error } = useStartGame();

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
                onClick={start}
                disabled={pending}
                aria-busy={pending}
                className="h-12 rounded-lg px-8 text-base font-semibold"
              >
                {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
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
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
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

      <footer className="border-t border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-sm text-muted-foreground">
          <span>Photos are used under their original licenses.</span>
          <Link
            href="/credits"
            className="inline-flex min-h-11 items-center rounded-lg px-2 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Photo credits
          </Link>
        </div>
      </footer>
    </div>
  );
}
