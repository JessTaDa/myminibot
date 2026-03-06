import { Telegraf, Markup } from "telegraf"
import type { Context } from "telegraf"
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages"
import fs from "fs"
import { config } from "./config.js"
import { handleMessage, type UserContent } from "./agent.js"
import { TelegramStreamSink } from "./stream.js"
import { initReminders } from "./reminders.js"

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

// Init reminders with Telegram send function
initReminders((chatId, text) => bot.telegram.sendMessage(chatId, text).then(() => {}))

// Pending approval callbacks
const pendingApprovals = new Map<
  string,
  { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> }
>()

// Handle approve/deny button presses
bot.action(/^(approve|deny):(.+)$/, (ctx) => {
  const action = ctx.match[1]
  const approvalId = ctx.match[2]
  const pending = pendingApprovals.get(approvalId)

  if (!pending) {
    ctx.answerCbQuery("Expired.").catch(() => {})
    return
  }

  clearTimeout(pending.timer)
  pendingApprovals.delete(approvalId)

  const approved = action === "approve"
  pending.resolve(approved)

  const messageText =
    ctx.callbackQuery.message && "text" in ctx.callbackQuery.message
      ? ctx.callbackQuery.message.text
      : ""
  ctx.editMessageText(messageText + `\n\n${approved ? "✅ Approved" : "❌ Denied"}`).catch(
    () => {}
  )
  ctx.answerCbQuery(approved ? "Approved" : "Denied").catch(() => {})
})

function processMessage(ctx: Context, content: UserContent): void {
  const userId = ctx.from!.id

  if (!isAllowed(userId)) return

  if (isRateLimited(userId)) {
    ctx.reply("Too many messages — slow down.").catch(() => {})
    return
  }

  enqueue(userId, async () => {
    await ctx.sendChatAction("typing")

    const sink = new TelegramStreamSink(ctx.chat!.id, ctx.telegram)

    const onApproval = async (command: string): Promise<boolean> => {
      const approvalId = `${userId}_${Date.now()}`

      const msg = await ctx.reply(
        `🔧 Shell command:\n\`\`\`\n${command}\n\`\`\`\nApprove?`,
        {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard([
            Markup.button.callback("✅ Approve", `approve:${approvalId}`),
            Markup.button.callback("❌ Deny", `deny:${approvalId}`),
          ]),
        }
      )

      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          pendingApprovals.delete(approvalId)
          resolve(false)
          ctx.telegram
            .editMessageText(
              ctx.chat!.id,
              msg.message_id,
              undefined,
              `🔧 Shell command:\n\`\`\`\n${command}\n\`\`\`\n\n⏰ Auto-denied (timeout)`
            )
            .catch(() => {})
        }, 60_000)

        pendingApprovals.set(approvalId, { resolve, timer })
      })
    }

    try {
      await handleMessage(userId, content, {
        onDelta: (token) => { sink.push(token).catch(() => {}) },
        onIterationEnd: () => { sink.newIteration().catch(() => {}) },
        onApproval,
      })
    } catch (err) {
      console.error("Agent error:", err)
      await sink.push("Something went wrong.")
    }

    await sink.finish()
  })
}

bot.on("text", (ctx) => {
  processMessage(ctx, ctx.message.text)
})

bot.on("photo", (ctx) => {
  const photos = ctx.message.photo
  const largest = photos[photos.length - 1]

  if (!isAllowed(ctx.from.id)) return

  enqueue(ctx.from.id, async () => {
    try {
      const fileLink = await ctx.telegram.getFileLink(largest.file_id)
      const res = await fetch(fileLink.href)
      if (!res.ok) throw new Error(`Failed to download photo: ${res.status}`)

      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > config.MAX_FILE_SIZE) {
        await ctx.reply("Photo too large (max 10MB).")
        return
      }

      const blocks: ContentBlockParam[] = [
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") },
        },
      ]

      const caption = ctx.message.caption
      if (caption) {
        blocks.push({ type: "text", text: caption })
      }

      processMessage(ctx, blocks)
    } catch (err) {
      console.error("Photo handling error:", err)
      await ctx.reply("Failed to process photo.")
    }
  })
})

bot.on("document", (ctx) => {
  const doc = ctx.message.document

  if (!isAllowed(ctx.from.id)) return

  const mime = doc.mime_type ?? ""
  const isImage = mime.startsWith("image/")
  const isPdf = mime === "application/pdf"

  if (!isImage && !isPdf) {
    ctx.reply("Unsupported file type. I can handle images and PDFs.").catch(() => {})
    return
  }

  enqueue(ctx.from.id, async () => {
    try {
      const fileLink = await ctx.telegram.getFileLink(doc.file_id)
      const res = await fetch(fileLink.href)
      if (!res.ok) throw new Error(`Failed to download document: ${res.status}`)

      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > config.MAX_FILE_SIZE) {
        await ctx.reply("File too large (max 10MB).")
        return
      }

      const blocks: ContentBlockParam[] = []

      if (isPdf) {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
        })
      } else {
        const imageMediaType = mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp"
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: imageMediaType, data: buf.toString("base64") },
        })
      }

      const caption = ctx.message.caption
      if (caption) {
        blocks.push({ type: "text", text: caption })
      }

      processMessage(ctx, blocks)
    } catch (err) {
      console.error("Document handling error:", err)
      await ctx.reply("Failed to process file.")
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
