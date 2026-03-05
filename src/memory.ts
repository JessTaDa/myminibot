import fs from "fs"
import path from "path"
import { config } from "./config.js"

const memoryPath = path.join(config.WORKSPACE_DIR, "MEMORY.md")

export function readMemory(): string {
  return fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, "utf-8") : ""
}

export function appendMemory(content: string): void {
  const date = new Date().toISOString().split("T")[0]
  fs.appendFileSync(memoryPath, `\n## ${date}\n${content.trim()}\n`)
}

export function searchMemory(query: string): string {
  const memory = readMemory()
  if (!memory) return ""

  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
  if (words.length === 0) return ""

  const lines = memory.split("\n")
  const hits: string[] = []

  lines.forEach((line, i) => {
    if (words.some(w => line.toLowerCase().includes(w))) {
      hits.push(lines.slice(Math.max(0, i - 1), i + 3).join("\n"))
    }
  })

  return hits.slice(0, 5).join("\n---\n")
}
