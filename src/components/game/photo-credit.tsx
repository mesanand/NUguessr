import type { PhotoCredit as PhotoCreditData } from "@/lib/game-types"
import { cn } from "@/lib/utils"
import { cleanText, safeHttpUrl, sourceLabel } from "./credit-utils"

/**
 * "Photo: {author} · {license} · via {source}" — the source part links to the
 * original. Everything is rendered as plain text (author strings come from
 * third-party metadata).
 */
export function PhotoCredit({ credit, className }: { credit: PhotoCreditData | null | undefined; className?: string }) {
  const author = cleanText(credit?.author)
  const license = cleanText(credit?.license)
  const label = sourceLabel(credit?.source)
  const href = safeHttpUrl(credit?.sourceUrl)

  const parts: React.ReactNode[] = []
  if (author) parts.push(<span key="author">{author}</span>)
  if (license) parts.push(<span key="license">{license}</span>)
  if (label || href) {
    const text = label ? `via ${label}` : "Source"
    parts.push(
      href ? (
        <a
          key="source"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
        >
          {text}
        </a>
      ) : (
        <span key="source">{text}</span>
      )
    )
  }
  if (parts.length === 0) return null

  return (
    <p className={cn("break-words text-sm text-muted-foreground", className)}>
      Photo:{" "}
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {part}
        </span>
      ))}
    </p>
  )
}
