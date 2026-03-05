import fs from "fs"
import path from "path"
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages"
import { config } from "./config.js"

export type Message = MessageParam

function sessionPath(userId: number): string {
  return path.join(config.SESSIONS_DIR, `${userId}.jsonl`)
}

export function loadSession(userId: number): Message[] {
  const p = sessionPath(userId)
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line) as Message } catch { return null } })
    .filter((m): m is Message => m !== null)
}

export function appendMessage(userId: number, message: Message): void {
  fs.appendFileSync(sessionPath(userId), JSON.stringify(message) + "\n")
}

export function trimSession(messages: Message[], maxLength: number): Message[] {
  return messages.length > maxLength ? messages.slice(-maxLength) : messages
}

export function summaryPath(userId: number): string {
  return path.join(config.SESSIONS_DIR, `${userId}.summary.md`)
}

export function loadSummary(userId: number): string {
  const p = summaryPath(userId)
  return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : ""
}

export function writeSummary(userId: number, summary: string): void {
  fs.writeFileSync(summaryPath(userId), summary)
}

export function rewriteSession(userId: number, messages: Message[]): void {
  const p = sessionPath(userId)
  const tmp = p + ".tmp"
  fs.writeFileSync(tmp, messages.map(m => JSON.stringify(m)).join("\n") + "\n")
  fs.renameSync(tmp, p)
}

export function needsCompaction(userId: number): boolean {
  const p = sessionPath(userId)
  if (!fs.existsSync(p)) return false
  const lines = fs.readFileSync(p, "utf-8").split("\n").filter(Boolean)
  return lines.length > config.COMPACTION_THRESHOLD
}
