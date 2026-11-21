import type { PhotoCredit as PhotoCreditData } from "@/lib/game-types"
import { cn } from "@/lib/utils"
import { cleanText, parseLicense, safeHttpUrl, sourceLabel } from "./credit-utils"

const LINK_CLASS = "font-medium text-foreground underline underline-offset-2 hover:text-primary"

/**
 * A license string with its deed linked when recognized ("CC BY-SA 4.0") and
 * any change note ("(cropped, text blurred)") as plain text. No "use client":
 * also rendered by the server /credits page.
 */
export function LicenseText({ license, className }: { license: string | null | undefined; className?: string }) {
  const parts = parseLicense(license)
  if (!parts) return null
  return (
    <span className={className}>
      {parts.href ? (
        <a href={parts.href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          {parts.text}
        </a>
      ) : (
        parts.text
      )}
      {parts.note && ` ${parts.note}`}
    </span>
  )
}

/**
 * "Photo: {author} · {license} · via {source}" — the license links to its
 * deed and the source part links to the original. Everything is rendered as
 * plain text (author strings come from third-party metadata).
 */
export function PhotoCredit({ credit, className }: { credit: PhotoCreditData | null | undefined; className?: string }) {
  const author = cleanText(credit?.author)
  const hasLicense = cleanText(credit?.license) !== null
  const label = sourceLabel(credit?.source)
  const href = safeHttpUrl(credit?.sourceUrl)

  const parts: React.ReactNode[] = []
  if (author) parts.push(<span key="author">{author}</span>)
  if (hasLicense) parts.push(<LicenseText key="license" license={credit?.license} />)
  if (label || href) {
    const text = label ? `via ${label}` : "Source"
    parts.push(
      href ? (
        <a key="source" href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
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
