import fs from "fs"
import path from "path"
import { config } from "./config.js"

const EXTENSIONS = new Set([".md", ".txt", ".ts", ".js", ".json", ".yaml", ".yml"])
const MAX_FILE_SIZE = 100 * 1024 // 100KB
const MAX_CHUNKS = 5

interface Chunk {
  file: string
  text: string
  score: number
}

function walkDir(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkDir(full))
    } else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      try {
        const stat = fs.statSync(full)
        if (stat.size <= MAX_FILE_SIZE) files.push(full)
      } catch { /* skip unreadable */ }
    }
  }
  return files
}

function chunkFile(content: string): string[] {
  const paragraphs: string[] = []
  let current: string[] = []

  for (const line of content.split("\n")) {
    if (line.trim() === "" && current.length > 0) {
      paragraphs.push(current.join("\n"))
      current = []
    } else {
      current.push(line)
      if (current.length >= 30) {
        paragraphs.push(current.join("\n"))
        current = []
      }
    }
  }
  if (current.length > 0) paragraphs.push(current.join("\n"))
  return paragraphs
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1)
}

function termFrequency(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1)
  return freq
}

export function searchWorkspace(query: string): string {
  const workspaceAbs = path.resolve(config.WORKSPACE_DIR)
  const files = walkDir(workspaceAbs)
  if (files.length === 0) return "No files found in workspace."

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return "Empty search query."

  const allChunks: { file: string; text: string; tf: Map<string, number> }[] = []

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf-8")
      const relPath = path.relative(workspaceAbs, file)
      for (const chunk of chunkFile(content)) {
        const tokens = tokenize(chunk)
        allChunks.push({ file: relPath, text: chunk, tf: termFrequency(tokens) })
      }
    } catch { /* skip unreadable */ }
  }

  if (allChunks.length === 0) return "No searchable content in workspace."

  // IDF: log(N / df) for each query term
  const docCount = allChunks.length
  const idf = new Map<string, number>()
  for (const term of queryTokens) {
    const df = allChunks.filter(c => c.tf.has(term)).length
    idf.set(term, df > 0 ? Math.log(docCount / df) : 0)
  }

  // Score each chunk with TF-IDF
  const scored: Chunk[] = allChunks.map(c => {
    let score = 0
    for (const term of queryTokens) {
      score += (c.tf.get(term) ?? 0) * (idf.get(term) ?? 0)
    }
    return { file: c.file, text: c.text, score }
  }).filter(c => c.score > 0)

  scored.sort((a, b) => b.score - a.score)

  const top = scored.slice(0, MAX_CHUNKS)
  if (top.length === 0) return "No matching content found."

  return top.map((c, i) =>
    `--- Result ${i + 1} [${c.file}] ---\n${c.text}`
  ).join("\n\n")
}
