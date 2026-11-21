// Helpers for rendering photo attribution. Plain module (no "use client") so
// both the client results view and the server-rendered /credits page use it.

const SOURCE_LABELS: Record<string, string> = {
  mapillary: "Mapillary",
  wikimedia: "Wikimedia Commons",
  own: "NUguessr contributors",
}

export function sourceLabel(source: string | null | undefined): string | null {
  if (!source) return null
  return SOURCE_LABELS[source] ?? null
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

/** Trim and collapse whitespace; null for empty strings. */
export function cleanText(value: string | null | undefined): string | null {
  if (!value) return null
  const text = value.replace(/\s+/g, " ").trim()
  return text.length > 0 ? text : null
}
