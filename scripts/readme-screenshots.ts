// Captures the screenshots used in README.md into docs/screenshots/.
//
//   npx tsx scripts/readme-screenshots.ts [baseUrl]   (default: the live site)
//
// Plays one real game as a fresh anonymous player (it shows up nowhere: no
// name is set, so it never reaches the leaderboard). The round-result screen
// is deliberately NOT captured: it pairs a photo with its answer.
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { chromium, devices, type Page } from "@playwright/test"
import sharp from "sharp"

const BASE = process.argv[2] ?? "https://www.mehr-anand.com/nuguessr"
const OUT = path.resolve("docs/screenshots")
const channel = process.env.E2E_CHANNEL ?? "msedge"

async function settle(page: Page, ms = 1200) {
  await page.waitForLoadState("networkidle").catch(() => undefined)
  await page.waitForTimeout(ms)
}

async function guessAndAdvance(page: Page, round: number) {
  await page.getByRole("button", { name: "Expand map to place your guess" }).click()
  await page.waitForTimeout(700)
  const map = page.locator(".leaflet-container").first()
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width * (0.4 + round * 0.04), box.y + box.height * 0.5)
  await page.getByRole("button", { name: "Submit guess" }).click()
  await page.getByRole("heading", { name: /^(It was |Here's where it was)/ }).waitFor({ timeout: 30_000 })
  const next = round < 5 ? "Start next round" : "View results"
  await page.getByRole("button", { name: next }).click()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel })

  // ---- desktop
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await desktop.newPage()
  await page.goto(BASE)
  await settle(page, 2000)
  await page.screenshot({ path: path.join(OUT, "home.png") })

  await page.getByRole("button", { name: /play now/i }).click()
  await page.waitForURL(/\/play\//, { timeout: 60_000 })
  await page.getByRole("img", { name: "Mystery campus location" }).waitFor({ timeout: 30_000 })
  await settle(page, 2500)
  await page.screenshot({ path: path.join(OUT, "play.png") })

  await page.getByRole("button", { name: "Expand map to place your guess" }).click()
  await page.waitForTimeout(900)
  const map = page.locator(".leaflet-container").first()
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.5)
  await settle(page, 800)
  await page.screenshot({ path: path.join(OUT, "guess-map.png") })
  await page.getByRole("button", { name: "Close map" }).click()
  await page.waitForTimeout(500)

  // Play the game out (results are not captured) to reach the summary.
  for (let round = 1; round <= 5; round++) {
    if (round > 1) {
      await page.getByRole("img", { name: "Mystery campus location" }).waitFor({ timeout: 30_000 })
      await page.waitForTimeout(600)
    }
    await guessAndAdvance(page, round)
  }
  await page.waitForURL(/\/play-finish/, { timeout: 60_000 })
  await page.getByText(/\/\s*25,000/).waitFor({ timeout: 30_000 })
  await settle(page, 1500)
  // Score header only: the route below lists place names, which would pair
  // with the round-1 photo in play.png.
  await page.screenshot({ path: path.join(OUT, "score.png"), clip: { x: 0, y: 0, width: 1440, height: 324 } })

  await page.goto(`${BASE}/shortcuts`)
  await settle(page)
  await page.keyboard.press("Shift+Slash")
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(OUT, "shortcuts.png") })
  await desktop.close()

  // ---- phone
  const phone = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 3 })
  const m = await phone.newPage()
  await m.goto(BASE)
  await m.getByRole("button", { name: /play now/i }).click()
  await m.waitForURL(/\/play\//, { timeout: 60_000 })
  await m.getByRole("img", { name: "Mystery campus location" }).waitFor({ timeout: 30_000 })
  await settle(m, 2500)
  await m.screenshot({ path: path.join(OUT, "phone-play.png") })
  await m.getByRole("button", { name: "Open map" }).click()
  await m.waitForTimeout(900)
  await m.screenshot({ path: path.join(OUT, "phone-map.png") })
  await phone.close()

  await browser.close()
  await toWebp()
  console.log("screenshots written to", OUT)
}

/** Shrink to WebP for the README and put the two phone shots side by side. */
async function toWebp() {
  sharp.cache(false)
  for (const name of ["home", "play", "guess-map", "score", "shortcuts"]) {
    const src = path.join(OUT, `${name}.png`)
    await sharp(src).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(OUT, `${name}.webp`))
    rmSync(src)
  }
  const [a, b] = await Promise.all(
    ["phone-play", "phone-map"].map((n) =>
      sharp(path.join(OUT, `${n}.png`)).resize({ height: 1200 }).toBuffer({ resolveWithObject: true })
    )
  )
  const gap = 48
  await sharp({
    create: { width: a.info.width + b.info.width + gap * 3, height: 1200 + gap * 2, channels: 3, background: "#0b0b0b" },
  })
    .composite([
      { input: a.data, left: gap, top: gap },
      { input: b.data, left: gap * 2 + a.info.width, top: gap },
    ])
    .webp({ quality: 78 })
    .toFile(path.join(OUT, "phone.webp"))
  for (const n of ["phone-play", "phone-map"]) rmSync(path.join(OUT, `${n}.png`))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
