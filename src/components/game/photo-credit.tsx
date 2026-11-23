import type { PhotoCredit as PhotoCreditData } from "@/lib/game-types"
import { cn } from "@/lib/utils"
import { cleanText, isContributed, parseLicense, safeHttpUrl, sourceLabel } from "./credit-utils"

const LINK_CLASS = "font-medium text-foreground underline underline-offset-2 hover:text-primary"

/**
 * A license string with its deed linked when recognized ("CC BY-SA 4.0") and
 * any change note ("(cropped, text blurred)") as plain text. No "use client":
 * also rendered by the server /credits page.
 */
export function LicenseText({ license, className }: { license: string | null | undefined; className?: string }) {
  const parts = parseLicense(license)
  if (!parts) return null
  // Contributors' own photos ("owned") have no public license to show; keep
  // only the change note, e.g. "(text blurred)".
  if (/^(owned|contributed)$/i.test(parts.text)) {
    return parts.note ? <span className={className}>{parts.note}</span> : null
  }
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
function parseLicenseNote(license: string): string | null {
  return parseLicense(license)?.note ?? null
}

export function PhotoCredit({ credit, className }: { credit: PhotoCreditData | null | undefined; className?: string }) {
  const author = cleanText(credit?.author)
  const own = isContributed(credit?.source)
  const license = cleanText(credit?.license)
  // Own and community photos' license is "owned"/"contributed" plus an
  // optional change note; the note is shown after the name, so nothing else
  // is listed for them.
  const hasLicense =
    license !== null && !(own && /^(owned|contributed)$/i.test(parseLicense(license)?.text ?? ""))
  // Own photos are credited by name only (no "via" source line).
  const label = own ? null : sourceLabel(credit?.source)
  const href = own ? null : safeHttpUrl(credit?.sourceUrl)

  const parts: React.ReactNode[] = []
  if (author) {
    // Own photos: the change note sits right after the name, no separator.
    const note = own && license ? parseLicenseNote(license) : null
    parts.push(
      <span key="author">
        {author}
        {note && ` ${note}`}
      </span>
    )
  }
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
