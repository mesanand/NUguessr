// Every keyboard shortcut on the site, in one place: the shortcuts page and
// the "?" overlay both render this list, and the handlers use the same keys.

export interface Shortcut {
  keys: string[]
  /** Shown as "M or Enter" when there are several keys. */
  action: string
}

export interface ShortcutGroup {
  title: string
  where: string
  shortcuts: Shortcut[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Anywhere",
    where: "Works on every page",
    shortcuts: [
      { keys: ["?"], action: "Show or hide this list of shortcuts" },
      { keys: ["Esc"], action: "Close the shortcuts list" },
      { keys: ["P"], action: "Play a new game (not during a round)" },
      { keys: ["L"], action: "Open the leaderboard (not during a game)" },
    ],
  },
  {
    title: "While guessing",
    where: "When a photo is on screen",
    shortcuts: [
      { keys: ["M"], action: "Open or close the guess map" },
      { keys: ["S"], action: "Switch the map between drawing and satellite" },
      { keys: ["Enter"], action: "Submit your pin (once you've dropped one)" },
      { keys: ["Z"], action: "Zoom the photo in or out" },
      { keys: ["Esc"], action: "Close the map, or zoom the photo back out" },
    ],
  },
  {
    title: "After a round",
    where: "On the round result",
    shortcuts: [{ keys: ["Enter", "N"], action: "Start the next round, or see your results after round 5" }],
  },
  {
    title: "Leaderboard",
    where: "On the leaderboard page",
    shortcuts: [{ keys: ["/"], action: "Search players" }],
  },
]

/** True when a key press should be left alone: typing in a field, or a modifier is held. */
export function isTypingOrModified(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
}

/** Opens the shortcuts overlay from anywhere (e.g. a "Shortcuts" button). */
export function openShortcuts() {
  window.dispatchEvent(new CustomEvent("nuguessr:shortcuts"))
}
