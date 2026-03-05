import { Telegraf } from "telegraf"
import fs from "fs"
import { config } from "./config.js"
import { handleMessage } from "./agent.js"

// Create directories once at startup
fs.mkdirSync(config.SESSIONS_DIR,  { recursive: true })
fs.mkdirSync(config.WORKSPACE_DIR, { recursive: true })

// ACL
function isAllowed(userId: number): boolean {
  return config.ALLOWED_USER_IDS.has(userId)
}

// Rate limiter
const rateMap = new Map<number, { count: number; resetAt: number }>()

function isRateLimited(userId: number): boolean {
  const now = Date.now()
  const entry = rateMap.get(userId)
  if (!entry || now > entry.resetAt) {
    rateMap.set(userId, { count: 1, resetAt: now + 60_000 })
    return false
  }
  if (entry.count >= config.MAX_MESSAGES_PER_MINUTE) return true
  entry.count++
  return false
}

// Clean stale rate limit entries every 5 minutes
// .unref() lets Node exit naturally without clearing the interval
setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(id)
  }
}, 5 * 60_000).unref()

// Lane queue — per-user Promise chain ensures serial processing
const queue = new Map<number, Promise<void>>()

function enqueue(userId: number, task: () => Promise<void>): void {
  const prev = queue.get(userId) ?? Promise.resolve()
  const next = prev.then(task).finally(() => {
    if (queue.get(userId) === next) queue.delete(userId)
  })
  queue.set(userId, next)
}

// Bot
const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN)

bot.on("text", (ctx) => {
  const userId = ctx.from.id
  const text   = ctx.message.text

  // Drop unauthorized users silently — replying would confirm the bot exists
  if (!isAllowed(userId)) return

  if (isRateLimited(userId)) {
    ctx.reply("Too many messages — slow down.").catch(() => {})
    return
  }

  enqueue(userId, async () => {
    await ctx.sendChatAction("typing")
    let reply = ""

    try {
      await handleMessage(userId, text, chunk => { reply += chunk })
    } catch (err) {
      console.error("Agent error:", err)
      reply = "Something went wrong."
    }

    if (!reply) return

    // Telegram message limit: 4096 chars
    for (let i = 0; i < reply.length; i += 4000) {
      const chunk = reply.slice(i, i + 4000)
      try {
        await ctx.reply(chunk, { parse_mode: "Markdown" })
      } catch {
        // Markdown parse error (unmatched formatting chars) — retry as plain text
        await ctx.reply(chunk)
      }
    }
  })
})

bot.launch().catch(err => {
  console.error("Failed to start bot:", err)
  process.exit(1)
})
console.log("MyAgent running.")

process.once("SIGINT",  () => bot.stop("SIGINT"))
process.once("SIGTERM", () => bot.stop("SIGTERM"))
