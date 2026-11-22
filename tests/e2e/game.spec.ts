import { expect, test, type Page, type Response } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"

// Full game: 4 guessed rounds + 1 timeout round, on desktop and mobile
// (projects in playwright.config.ts). Also checks that nothing names or
// locates the place before a guess, and which tile servers the map uses.

const SHOTS = path.join(__dirname, "screenshots")
fs.mkdirSync(SHOTS, { recursive: true })

const ANSWER_KEYS = /"(lat|lng|name|notes|sourceUrl|source_url|actual|credit|author)"\s*:/

function count(body: string, re: RegExp): number {
  return (body.match(new RegExp(re.source, "g")) ?? []).length
}

/** Seconds left on the round timer ("00:41" -> 41). */
async function timerSeconds(page: Page): Promise<number> {
  const text = (await page.getByRole("timer").textContent()) ?? ""
  const m = text.match(/(\d+):(\d+)/)
  if (!m) throw new Error(`no timer text: ${text}`)
  return Number(m[1]) * 60 + Number(m[2])
}

async function shot(page: Page, project: string, step: string) {
  await page.screenshot({ path: path.join(SHOTS, `${project}-${step}.png`), fullPage: false })
}

test("play a full game without answer leaks", async ({ page }, testInfo) => {
  const project = testInfo.project.name
  const mobile = project === "mobile"
  test.setTimeout(240_000)

  // Record server-action responses (Next sends them with a `next-action` request header).
  // Photos are revealed one round at a time, so a response while round N is
  // being guessed ("before-guess-N") may carry results of rounds < N only.
  const actionBodies: { phase: string; body: string }[] = []
  let phase = "before-guess-1"
  const tiles: { phase: string; host: string }[] = []
  let basemapLoaded = false
  page.on("response", async (res: Response) => {
    const req = res.request()
    const url = res.url()
    if (/cartocdn\.com|arcgisonline\.com|openstreetmap\.org/.test(url)) tiles.push({ phase, host: new URL(url).host })
    if (url.endsWith("/map/campus-basemap.json") && res.ok()) basemapLoaded = true
    if (req.method() === "POST" && req.headers()["next-action"]) {
      try {
        actionBodies.push({ phase, body: await res.text() })
      } catch {
        /* body unavailable (navigation) */
      }
    }
  })
  const consoleErrors: string[] = []
  page.on("pageerror", (e) => consoleErrors.push(e.message))

  // ---- start
  await page.goto("/")
  await expect(page).toHaveTitle("NUGuessr")
  await shot(page, project, "01-home")
  await page.getByRole("button", { name: /play now/i }).click()
  await page.waitForURL(/\/play\/[0-9a-f-]{36}$/, { timeout: 60_000 })

  for (let round = 1; round <= 5; round++) {
    // ---- the photo loads, and nothing on the page names the place
    const photo = page.getByRole("img", { name: "Mystery campus location" })
    await expect(photo).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { timeout: 30_000 })
      .toBeGreaterThan(100)
    const src = (await photo.getAttribute("src")) ?? ""
    expect(src, "image file name must be a UUID").toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp/)
    await expect(page).toHaveTitle("NUGuessr")
    await expect(page.getByText(/^It was /)).toHaveCount(0)
    await expect(page.getByText(/^Photo:/)).toHaveCount(0)
    const html = await page.content()
    expect(html).not.toMatch(ANSWER_KEYS)
    if (round === 1) await shot(page, project, "02-round-photo")

    if (round === 2) {
      // ---- the round clock lives on the server: reloading mid-round must
      // not reset the timer to 0:45.
      await page.waitForTimeout(4000)
      const before = await timerSeconds(page)
      expect(before).toBeLessThanOrEqual(42)
      await page.reload()
      await expect(photo).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole("timer")).toBeVisible()
      const after = await timerSeconds(page)
      expect(after, "timer continues after reload").toBeLessThanOrEqual(before)
      expect(after).toBeGreaterThan(0)
      expect(await photo.getAttribute("src"), "same photo after reload").toBe(src)
      await expect(page.getByText(new RegExp(`^${round} / 5$`))).toBeVisible()
    }

    const timeoutRound = round === 3
    if (timeoutRound) {
      // Let the 45 s timer run out without guessing. The timeout submission's
      // response legitimately reveals the answer, so label it as post-guess.
      phase = `after-timeout-${round}`
      await expect(page.getByText(/time's up/i)).toBeVisible({ timeout: 60_000 })
      await shot(page, project, "05-timeout-result")
    } else {
      // ---- open the guess map
      if (mobile) await page.getByRole("button", { name: "Open map" }).click()
      else await page.getByRole("button", { name: "Expand map to place your guess" }).click()
      const map = page.locator(".leaflet-container").first()
      await expect(map).toBeVisible()
      await page.waitForTimeout(800) // expand transition + invalidateSize

      if (round === 1) {
        await shot(page, project, "03-guess-map")
        await page.getByRole("button", { name: "Switch to satellite view" }).click()
        await page.waitForTimeout(1500)
        await shot(page, project, "03b-satellite")
        await page.getByRole("button", { name: "Switch to map view" }).click()
      }

      // ---- drop a pin and submit
      const box = (await map.boundingBox())!
      await page.mouse.click(box.x + box.width * (0.35 + round * 0.05), box.y + box.height * 0.5)
      await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1)
      phase = `after-guess-${round}`
      await page.getByRole("button", { name: "Submit guess" }).click()
      await expect(page.getByRole("heading", { name: /^(It was |Here's where it was)/ })).toBeVisible({ timeout: 30_000 })
      if (round === 1) await shot(page, project, "04-result")
    }

    // ---- results: name, distance/points and a linked photo credit
    phase = `after-guess-${round}`
    await expect(page.getByText(/points/i).first()).toBeVisible()
    const credit = page.getByText(/^Photo:/)
    await expect(credit).toBeVisible()
    await expect(credit.getByRole("link", { name: /^via / })).toHaveAttribute("href", /^https:\/\//)
    await expect(credit.getByRole("link", { name: /^(CC|Public domain)/i })).toHaveAttribute(
      "href",
      /^https:\/\/creativecommons\.org\/(licenses|publicdomain)\//
    )
    await expect(page.getByText(/â€|Â·/)).toHaveCount(0) // no mojibake

    if (round < 5) {
      // The next photo is revealed (and its clock started) only now.
      phase = `before-guess-${round + 1}`
      await page.getByRole("button", { name: "Start next round" }).click()
    } else {
      await page.getByRole("button", { name: "View results" }).click()
    }
  }

  // ---- finish page shows the server total
  await page.waitForURL(/\/play-finish\?game=[0-9a-f-]{36}/, { timeout: 60_000 })
  await expect(page.getByText(/\/\s*25,000/)).toBeVisible({ timeout: 30_000 })
  await shot(page, project, "06-finish")

  // ---- no answer data in any server-action response before its guess
  // While round N is open, a response may hold results (and photos) of the
  // N-1 submitted rounds plus round N's photo, and nothing more.
  const leaky = actionBodies.filter((a) => {
    const m = a.phase.match(/^before-guess-(\d+)$/)
    if (!m) return false
    const n = Number(m[1])
    return count(a.body, /"actual"\s*:/) > n - 1 || count(a.body, /"sourceUrl"\s*:/) > n - 1 || count(a.body, /\.webp"/) > n
  })
  expect(leaky.map((l) => `${l.phase}: ${l.body.slice(0, 300)}`), "server responses before a guess leak the answer").toEqual([])
  const firstRound = actionBodies.filter((a) => a.phase === "before-guess-1")
  expect(firstRound.length).toBeGreaterThan(0)
  expect(firstRound.filter((a) => ANSWER_KEYS.test(a.body)).map((a) => a.body.slice(0, 200))).toEqual([])
  // Future photos are never sent ahead of their round.
  expect(firstRound.every((a) => count(a.body, /\.webp"/) <= 1)).toBe(true)

  // ---- guess map: our label-free drawn basemap + Esri satellite; labeled OSM
  // tiles only appear on results maps (after a guess), never while guessing.
  expect(basemapLoaded, "label-free campus basemap loaded").toBe(true)
  const guessing = tiles.filter((t) => t.phase.startsWith("before-guess"))
  expect(guessing.some((t) => t.host.includes("arcgisonline.com")), "satellite tiles loaded").toBe(true)
  expect(guessing.filter((t) => /openstreetmap|cartocdn/.test(t.host)), "labeled tiles while guessing").toEqual([])

  expect(consoleErrors).toEqual([])
})

test("guess map is locked to campus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "checked once on desktop")
  await page.goto("/")
  await page.getByRole("button", { name: /play now/i }).click()
  await page.waitForURL(/\/play\/[0-9a-f-]{36}$/, { timeout: 60_000 })
  await page.getByRole("button", { name: "Expand map to place your guess" }).click()
  const map = page.locator(".leaflet-container").first()
  await expect(map).toBeVisible()
  await page.waitForTimeout(800)
  // Zoom out as far as possible: min zoom stops at campus scale.
  for (let i = 0; i < 6; i++) {
    await map.hover()
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(300)
  }
  const zoomOut = page.locator(".leaflet-control-zoom-out")
  await expect(zoomOut).toHaveClass(/leaflet-disabled/)
  // Drag far away: maxBounds viscosity pulls the view back to campus.
  const box = (await map.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 2000, box.y + box.height / 2 + 2000, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  // Switch to satellite and check every visible tile is near campus: the view
  // could not be dragged away (CAMPUS_BOUNDS padded by 0.004°, plus one tile).
  await page.getByRole("button", { name: "Switch to satellite view" }).click()
  await page.waitForTimeout(2000)
  const centers = await page.locator("img.leaflet-tile").evaluateAll((els) =>
    els.map((e) => {
      const m = (e as HTMLImageElement).src.match(/\/tile\/(\d+)\/(\d+)\/(\d+)/)
      if (!m) return null
      const [z, y, x] = [Number(m[1]), Number(m[2]) + 0.5, Number(m[3]) + 0.5]
      const n = 2 ** z
      const lng = (x / n) * 360 - 180
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
      return { z, lat, lng }
    })
  )
  const tiles = centers.filter((c): c is { z: number; lat: number; lng: number } => c !== null)
  expect(tiles.length).toBeGreaterThan(0)
  for (const t of tiles) {
    expect(t.z).toBeGreaterThanOrEqual(15)
    expect(t.lat).toBeGreaterThan(42.334 - 0.004 - 0.012)
    expect(t.lat).toBeLessThan(42.3445 + 0.004 + 0.012)
    expect(t.lng).toBeGreaterThan(-71.096 - 0.004 - 0.012)
    expect(t.lng).toBeLessThan(-71.083 + 0.004 + 0.012)
  }
})
