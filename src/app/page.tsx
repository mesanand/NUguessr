"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Loader2 } from "lucide-react";
import { MainNav } from "@/components/main-nav";
import { Button } from "@/components/ui/button";
import { Icons } from "@/components/icons";
import { useStartGame } from "@/components/game/use-start-game";

const steps = [
  {
    title: "Look",
    body: "You get five photos taken somewhere on Northeastern's Boston campus.",
  },
  {
    title: "Pin",
    body: "Drop a pin on the map where you think each photo was taken. You have 45 seconds.",
  },
  {
    title: "Score",
    body: "Up to 5,000 points a round. The closer your pin, the more you get.",
  },
];

export default function HomePage() {
  // Games are created on the server (start_game RPC); the URL is just the
  // game id, so it reveals nothing about the rounds.
  const { start, pending, error } = useStartGame();

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <MainNav />

      <main className="flex-1">
        {/* Hero: a campus photo under an ink panel with the pitch */}
        <section className="relative isolate overflow-hidden bg-ink text-ink-foreground">
          <Image
            src="/background.jpg"
            alt=""
            fill
            sizes="100vw"
            className="-z-10 object-cover opacity-45"
            priority
          />
          <div className="mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col justify-end gap-6 px-4 pb-12 pt-24 md:min-h-[64vh] md:pb-16">
            <div className="h-1 w-16 bg-primary" aria-hidden="true" />
            <p className="sign-label text-ink-foreground/75">
              A campus geography game · Boston
            </p>
            <h1 className="max-w-3xl text-5xl uppercase leading-[0.95] sm:text-7xl">
              Think you know <span className="text-primary">Northeastern?</span>
            </h1>
            <p className="max-w-xl text-lg text-ink-foreground/85">
              Five real photos from around campus. Pin each one on the map
              before the clock runs out.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button
                type="button"
                size="lg"
                onClick={start}
                disabled={pending}
                aria-busy={pending}
                className="h-14 rounded-md px-10 text-lg font-semibold uppercase tracking-wide"
              >
                {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
                Play now
                {!pending && <ArrowRight aria-hidden="true" />}
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-14 rounded-md border-ink-foreground/30 bg-transparent px-6 text-base text-ink-foreground hover:bg-ink-foreground/10 hover:text-ink-foreground"
              >
                <Link href="/leaderboards">
                  <Icons.trophy aria-hidden="true" />
                  Leaderboards
                </Link>
              </Button>
            </div>
            {error && (
              <p role="alert" className="rounded-md bg-card px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </section>

        {/* How it works: three stops on a line */}
        <section aria-labelledby="how-it-works" className="mx-auto w-full max-w-5xl px-4 py-14">
          <h2 id="how-it-works" className="text-3xl uppercase">
            How it works
          </h2>
          <ol className="relative mt-8 grid gap-8 sm:grid-cols-3 sm:gap-6">
            {/* The line joining the stops */}
            <span
              aria-hidden="true"
              className="absolute bottom-2 left-[11px] top-2 w-[3px] bg-primary sm:bottom-auto sm:left-3 sm:right-[calc(33.333%-28px)] sm:top-[11px] sm:h-[3px] sm:w-auto"
            />
            {steps.map((step, i) => (
              <li key={step.title} className="relative flex gap-4 sm:flex-col">
                <span
                  aria-hidden="true"
                  className="relative z-10 mt-0.5 block size-6 shrink-0 rounded-full border-[4px] border-primary bg-background"
                />
                <div>
                  <p className="font-mono text-xs text-muted-foreground">Stop {i + 1}</p>
                  <h3 className="font-display text-2xl font-bold uppercase tracking-wide">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-base text-muted-foreground">{step.body}</p>
                </div>
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
            className="inline-flex min-h-11 items-center rounded-md px-2 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Photo credits
          </Link>
        </div>
      </footer>
    </div>
  );
}
