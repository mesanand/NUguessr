// Captures the screenshots used in README.md into docs/screenshots/.
//
//   npx tsx scripts/readme-screenshots.ts [baseUrl] [--contribute]   (default: the live site)
//
// Plays one real game as a fresh anonymous player (it shows up nowhere: no
// name is set, so it never reaches the leaderboard). The round-result screen
// is deliberately NOT captured: it pairs a photo with its answer.
//
// Also captures the "Add your photo" page with the synthetic fixture photos in
// scripts/fixtures/contribute. It never presses Send, so nothing is uploaded.
// --contribute captures only those.
import { mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { chromium, devices, type Browser, type Page } from "@playwright/test"
import sharp from "sharp"

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith("--")) ?? "https://www.mehr-anand.com/nuguessr"
const CONTRIBUTE_ONLY = args.includes("--contribute")
const FIXTURES = path.resolve("scripts/fixtures/contribute")
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
  await contributeShots(browser)
  if (CONTRIBUTE_ONLY) {
    await browser.close()
    console.log("contribute screenshots written to", OUT)
    return
  }

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

/** "Add your photo": the page header, then a photo being pinned and described. Never sends. */
async function contributeShots(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  // Belt and braces: block any upload or submit even if a click went astray.
  await page.route(/\/storage\/v1\/object\/submissions|\/rpc\/submit_photo/, (route) => route.abort())
  await page.goto(`${BASE}/contribute`)
  await page.getByRole("heading", { name: /nobody would/i }).waitFor()
  await settle(page, 1500)
  // Header + pitch, down to the "Pick your photos" button.
  const pick = (await page.getByRole("button", { name: /choose photos/i }).boundingBox())!
  await page.screenshot({
    path: path.join(OUT, "contribute.png"),
    clip: { x: 0, y: 0, width: 1440, height: Math.min(900, pick.y + pick.height + 20) },
  })

  await page.setInputFiles("#photo-input", [path.join(FIXTURES, "no-gps.jpg")])
  const map = page.locator('[role=region][aria-label^="Map for"]').first()
  await map.waitFor()
  await map.scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.52, box.y + box.height * 0.48)
  await page.getByLabel("Taken indoors").first().check()
  await page.getByLabel("Building").fill("Snell Library")
  await page.locator("#credit-name").fill("Your name here")
  await page.getByLabel("Your Northeastern email").fill("husky.h@northeastern.edu")
  for (const cb of await page.locator("fieldset input[type=checkbox]").all()) await cb.check()
  await settle(page, 1200)
  // The sticky nav would land mid-page in a full-page capture.
  await page.addStyleTag({ content: "header, nav { position: static !important; }" })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)

  // Page-coordinate box from the top of one heading to the bottom of an element.
  const span = async (fromHeading: RegExp, to: ReturnType<Page["locator"]>) => {
    const h = page.getByRole("heading", { name: fromHeading })
    return page.evaluate(
      ([a, b]) => {
        const r1 = a!.getBoundingClientRect()
        const r2 = b!.getBoundingClientRect()
        const pad = 28
        const left = Math.min(r1.left, r2.left) - pad
        const right = Math.max(r1.right, r2.right) + pad
        return {
          x: left,
          y: r1.top + window.scrollY - pad,
          width: right - left,
          height: r2.bottom - r1.top + pad * 2,
        }
      },
      [await h.elementHandle(), await to.elementHandle()] as const
    )
  }
  // Step 2 runs from its heading to just above step 3's heading.
  const step3 = (await page.getByRole("heading", { name: /credit and send/i }).boundingBox())!
  const sendClip = await span(/credit and send/i, page.getByRole("button", { name: /send photo/i }))
  const step2 = (await page.getByRole("heading", { name: /where was it taken/i }).boundingBox())!
  const pinClip = { x: sendClip.x, y: step2.y - 28, width: sendClip.width, height: step3.y - step2.y - 4 }
  await page.screenshot({ path: path.join(OUT, "contribute-pin.png"), fullPage: true, clip: pinClip })
  await page.screenshot({ path: path.join(OUT, "contribute-send.png"), fullPage: true, clip: sendClip })
  await ctx.close()

  sharp.cache(false)
  for (const name of ["contribute", "contribute-pin", "contribute-send"]) {
    const src = path.join(OUT, `${name}.png`)
    await sharp(src).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(OUT, `${name}.webp`))
    rmSync(src)
  }
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
