import { expect, test } from "@playwright/test"

// Reloading on a results screen must show that result again — not silently
// start the next round's 45 s server clock.
test("reload on a result keeps the result and doesn't start the next round", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "checked once on desktop")
  await page.goto("/")
  await page.getByRole("button", { name: /test your skills/i }).click()
  await page.waitForURL(/\/play\/[0-9a-f-]{36}$/, { timeout: 60_000 })

  await page.getByRole("button", { name: "Expand map to place your guess" }).click()
  const map = page.locator(".leaflet-container").first()
  await expect(map).toBeVisible()
  await page.waitForTimeout(800)
  const box = (await map.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.getByRole("button", { name: "Submit guess" }).click()
  const heading = page.getByRole("heading", { name: /^(It was |Here's where it was)/ })
  await expect(heading).toBeVisible({ timeout: 30_000 })
  const resultText = await heading.innerText()

  await page.reload()
  await expect(page.getByRole("heading", { name: resultText })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("img", { name: "Mystery campus location" })).toHaveCount(0)

  // Only pressing "Start next round" reveals round 2 (with a fresh full clock).
  await page.getByRole("button", { name: "Start next round" }).click()
  await expect(page.getByRole("img", { name: "Mystery campus location" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/2\s*\/\s*5/).first()).toBeVisible()
  const timer = await page.getByLabel(/remaining/).innerText()
  const secs = Number(timer.split(":")[1])
  expect(secs).toBeGreaterThanOrEqual(40)
})
