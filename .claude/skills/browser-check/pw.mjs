// Playwright helpers for a Chrysalis started by start.sh. start.sh copies this
// file into $WORK next to playwright-core: write your script in $WORK and
//   import { open, send, shot } from "./pw.mjs"
import fs from "node:fs"
import { chromium } from "playwright-core"

const env = Object.fromEntries(
  fs.readFileSync(new URL("./env", import.meta.url), "utf8").split("\n")
    .map((l) => /^export (\w+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]),
)
export const ENGINE_URL = env.ENGINE_URL
export const MODEL_REF = env.MODEL_REF
export const DATA = env.DATA
export const WORK = env.WORK

/** The Chromium this machine has (never `playwright install`). */
function chromePath() {
  const root = "/opt/pw-browsers"
  for (const d of fs.readdirSync(root).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const p = `${root}/${d}/chrome-linux/chrome`
    if (fs.existsSync(p)) return p
  }
  throw new Error(`no chromium under ${root}`)
}

let browser
/** A logged-in page. path: "/agent/" (agent page) or "/" (shell).
 *  theme: the agent page reads localStorage["chrysalis-theme"], not the OS. */
export async function open({ path = "/agent/", width = 1280, height = 800, theme = "dark", lang } = {}) {
  browser ??= await chromium.launch({ executablePath: chromePath() })
  const page = await browser.newPage({ viewport: { width, height } })
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message))
  await page.goto(ENGINE_URL + "/")
  await page.evaluate(async ({ theme, model, lang }) => {
    const r = await fetch("/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "molfar", password: "test1234" }) })
    if (!r.ok) throw new Error(`login ${r.status}`)
    localStorage.setItem("chrysalis-theme", theme)
    localStorage.setItem("agent-ui-model", model)
    if (lang) localStorage.setItem("chrysalis-lang", lang)
  }, { theme, model: MODEL_REF, lang })
  await page.goto(ENGINE_URL + path)
  return page
}

/** Type a message on the agent page and wait until the run settles. */
export async function send(page, text, { timeout = 30000 } = {}) {
  const box = page.getByPlaceholder("Ask Molfar")
  await box.waitFor({ timeout })
  await box.fill(text)
  await box.press("Enter")
  // the stop button shows while a run is going
  await page.waitForTimeout(500)
  await page.waitForFunction(() => !document.querySelector('[aria-label="Stop generating"]'), null, { timeout }).catch(() => {})
  await page.waitForTimeout(300)
}

/** Screenshot into $WORK; also reports sideways scroll, the usual phone bug. */
export async function shot(page, name) {
  const p = `${WORK}/${name}.png`
  await page.screenshot({ path: p })
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  console.log(`shot ${p}${sideways > 0 ? `  (page scrolls sideways by ${sideways}px)` : ""}`)
  return p
}

/** Point the mock model at a new script of turns. */
export async function turns(list) {
  const r = await fetch(env.MOCK_URL + "/__turns", { method: "POST", body: JSON.stringify(list) })
  if (!r.ok) throw new Error(`mock turns ${r.status}`)
}

export async function close() {
  await browser?.close()
  browser = undefined
}
