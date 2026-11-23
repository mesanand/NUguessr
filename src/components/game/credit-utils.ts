// Helpers for rendering photo attribution. Plain module (no "use client") so
// both the client results view and the server-rendered /credits page use it.

const SOURCE_LABELS: Record<string, string> = {
  mapillary: "Mapillary",
  wikimedia: "Wikimedia Commons",
  own: "NUguessr contributors",
  community: "NUguessr community",
}

export function sourceLabel(source: string | null | undefined): string | null {
  if (!source) return null
  return SOURCE_LABELS[source] ?? null
}

/**
 * Contributors' photos ("own" from the maintainers, "community" from the
 * Add-your-photo page) are credited by name only: no license deed, no
 * source link.
 */
export function isContributed(source: string | null | undefined): boolean {
  return source === "own" || source === "community"
}

/** Only http(s) URLs are ever used as hrefs (never javascript:, data:, ...). */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null
  } catch {
    return null
  }
}

/** Home pages for the source sites (used where no per-photo link is shown). */
const SOURCE_HOMES: Record<string, string> = {
  mapillary: "https://www.mapillary.com",
  wikimedia: "https://commons.wikimedia.org",
}

export function sourceHomeUrl(source: string | null | undefined): string | null {
  if (!source) return null
  return SOURCE_HOMES[source] ?? null
}

export interface LicenseParts {
  /** The license itself, e.g. "CC BY-SA 4.0" */
  text: string
  /** Deed URL when the license is recognized */
  href: string | null
  /** Trailing change note including parentheses, e.g. "(cropped, text blurred)" */
  note: string | null
}

/**
 * Split "CC BY-SA 4.0 (cropped, text blurred)" into the license and its change
 * note, and find the Creative Commons deed for recognized licenses.
 */
export function parseLicense(value: string | null | undefined): LicenseParts | null {
  const license = cleanText(value)
  if (!license) return null
  const m = license.match(/^(.*?)\s*(\([^()]*\))$/)
  const text = m && m[1] ? m[1] : license
  const note = m && m[1] ? m[2] : null
  return { text, href: licenseDeedUrl(text), note }
}

function licenseDeedUrl(license: string): string | null {
  const cc = license.match(/^cc[\s-]*by([\s-]*sa)?[\s-]*(\d\.\d)$/i)
  if (cc) return `https://creativecommons.org/licenses/${cc[1] ? "by-sa" : "by"}/${cc[2]}/`
  if (/^cc[\s-]*0([\s-]*1\.0)?$/i.test(license) || /^cc[\s-]*zero$/i.test(license)) {
    return "https://creativecommons.org/publicdomain/zero/1.0/"
  }
  if (/^public[\s-]*domain$/i.test(license) || /^pd$/i.test(license)) {
    return "https://creativecommons.org/publicdomain/mark/1.0/"
  }
  return null
}

/** Trim and collapse whitespace; null for empty strings. */
export function cleanText(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > 0 ? text : null
}
