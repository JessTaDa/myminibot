import Anthropic from "@anthropic-ai/sdk"
import type { TextBlock } from "@anthropic-ai/sdk/resources/messages"
import { config } from "./config.js"
import {
  loadSession,
  loadSummary,
  writeSummary,
  rewriteSession,
  needsCompaction,
  type Message,
} from "./session.js"

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

function formatMessages(messages: Message[]): string {
  return messages
    .map((m) => {
      if (typeof m.content === "string") return `${m.role}: ${m.content}`
      if (Array.isArray(m.content)) {
        return m.content
          .map((block) => {
            if ("text" in block) return `${m.role}: ${block.text}`
            if ("type" in block && block.type === "tool_result") {
              return `tool_result: ${typeof block.content === "string" ? block.content : "[complex]"}`
            }
            return ""
          })
          .filter(Boolean)
          .join("\n")
      }
      return `${m.role}: [complex content]`
    })
    .join("\n")
}

export async function compactSession(userId: number): Promise<void> {
  if (!needsCompaction(userId)) return

  const messages = loadSession(userId)
  const keep = messages.slice(-config.COMPACTION_KEEP)
  const old = messages.slice(0, messages.length - config.COMPACTION_KEEP)

  if (old.length === 0) return

  const existingSummary = loadSummary(userId)

  const summaryPrompt = [
    "Summarize the following conversation messages into a concise context summary.",
    "Focus on: key facts, user preferences, ongoing tasks, and important decisions.",
    "Keep it under 500 words. Use bullet points.",
    existingSummary &&
      `\nExisting summary to incorporate:\n${existingSummary}`,
  ]
    .filter(Boolean)
    .join("\n")

  const formatted = formatMessages(old)

  try {
    const response = await client.messages.create({
      model: config.MODEL,
      max_tokens: 1024,
      system: summaryPrompt,
      messages: [{ role: "user", content: formatted }],
    })

    const summary = response.content
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")

    if (summary) {
      writeSummary(userId, summary)
      rewriteSession(userId, keep)
      console.log(
        `Compacted session for user ${userId}: ${messages.length} → ${keep.length} messages`
      )
    }
  } catch (err) {
    console.error("Compaction failed (non-fatal):", err)
  }
}
