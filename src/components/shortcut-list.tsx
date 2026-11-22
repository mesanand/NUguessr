import { SHORTCUT_GROUPS } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"

/** A key cap, like a key on a keyboard. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-border border-b-[3px] bg-card px-2 font-mono text-xs font-semibold text-foreground",
        className
      )}
    >
      {children}
    </kbd>
  )
}

/** The full list of shortcuts, grouped. Used by /shortcuts and the "?" overlay. */
export function ShortcutList({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("grid gap-6", !compact && "md:grid-cols-2")}>
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} aria-labelledby={`sc-${group.title}`}>
          <div className="flex items-baseline justify-between gap-3 border-b-[3px] border-ink pb-1">
            <h3 id={`sc-${group.title}`} className="font-display text-xl font-bold uppercase tracking-wide">
              {group.title}
            </h3>
            <span className="text-xs text-muted-foreground">{group.where}</span>
          </div>
          <dl className="divide-y divide-border">
            {group.shortcuts.map((s) => (
              <div key={s.action} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-sm">{s.action}</dt>
                <dd className="flex shrink-0 items-center gap-1.5">
                  {s.keys.map((k, i) => (
                    <span key={k} className="inline-flex items-center gap-1.5">
                      {i > 0 && <span className="text-xs text-muted-foreground">or</span>}
                      <Kbd>{k}</Kbd>
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
