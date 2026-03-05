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
