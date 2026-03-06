import fs from "fs"
import path from "path"
import type { Tool } from "@anthropic-ai/sdk/resources/messages"
import { config } from "./config.js"
import { appendMemory } from "./memory.js"
import { executeCommand } from "./shell.js"
import { searchWorkspace } from "./workspace-search.js"
import { exaSearch } from "./web-search.js"
import { setReminder, listReminders, cancelReminder } from "./reminders.js"

const workspaceAbs = path.resolve(config.WORKSPACE_DIR)

// SECURITY: Resolve real path and verify it stays inside workspace.
// Uses realpathSync to follow symlinks — prevents symlink escapes.
// Also blocks agent from overwriting SOUL.md (its own personality/rules).
function guardPath(userPath: string, mustExist: boolean): string {
  const resolved = path.resolve(workspaceAbs, userPath)

  // Basic prefix check on the logical path first
  if (!resolved.startsWith(workspaceAbs + path.sep) && resolved !== workspaceAbs) {
    throw new Error("Access denied: path outside workspace")
  }

  // Symlink protection: resolve the real filesystem path
  if (mustExist) {
    // File must exist — resolve its real path
    const real = fs.realpathSync(resolved)
    if (!real.startsWith(workspaceAbs + path.sep) && real !== workspaceAbs) {
      throw new Error("Access denied: path outside workspace (symlink)")
    }
  } else {
    // File may not exist yet — resolve the parent directory's real path
    const parentDir = path.dirname(resolved)
    if (fs.existsSync(parentDir)) {
      const realParent = fs.realpathSync(parentDir)
      if (!realParent.startsWith(workspaceAbs + path.sep) && realParent !== workspaceAbs) {
        throw new Error("Access denied: path outside workspace (symlink)")
      }
    }
  }

  return resolved
}

const _tools: Tool[] = [
  {
    name: "read_file",
    description: "Read a file from the workspace. Path is relative to workspace root.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within workspace" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file in the workspace. Creates it if it doesn't exist.",
    input_schema: {
      type: "object",
      properties: {
        path:    { type: "string", description: "Relative path within workspace" },
        content: { type: "string", description: "Content to write" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "memory_append",
    description: "Save a note to long-term memory. Use for facts worth remembering across conversations: preferences, ongoing projects, important details.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "What to remember" }
      },
      required: ["content"]
    }
  },
  {
    name: "shell_exec",
    description:
      "Execute a shell command. Requires user approval before running. Working directory is the workspace root.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "think",
    description: "Use this tool to think step-by-step about a problem. Your thoughts are private and not shown to the user. Use it to plan, reason, or break down complex tasks before responding.",
    input_schema: {
      type: "object",
      properties: {
        thought: { type: "string", description: "Your step-by-step reasoning" }
      },
      required: ["thought"]
    }
  },
  {
    name: "workspace_search",
    description: "Search across all workspace files using keyword matching. Returns the most relevant text chunks. Use this to find information in the workspace when you don't know which file to look in.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords" }
      },
      required: ["query"]
    }
  },
]

_tools.push(
  {
    name: "set_reminder",
    description: "Set a reminder that will be sent to the user after a delay. Max delay is 24 hours.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Reminder message" },
        delay_seconds: { type: "number", description: "Delay in seconds before the reminder fires" }
      },
      required: ["message", "delay_seconds"]
    }
  },
  {
    name: "list_reminders",
    description: "List all active reminders for the current user.",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "cancel_reminder",
    description: "Cancel an active reminder by its ID.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Reminder ID to cancel" }
      },
      required: ["id"]
    }
  },
)

if (config.EXA_API_KEY) {
  _tools.push({
    name: "web_search",
    description: "Search the web using Exa. Returns top 5 results with title, URL, and snippet.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" }
      },
      required: ["query"]
    }
  })
}

export const tools: Tool[] = _tools

export type ApprovalCallback = (command: string) => Promise<boolean>

export interface ToolContext {
  chatId: number
  onApproval?: ApprovalCallback
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx?: ToolContext
): Promise<string> {
  if (name === "read_file") {
    const safePath = guardPath(String(input.path), true)
    if (!fs.existsSync(safePath)) return `File not found: ${input.path}`
    return fs.readFileSync(safePath, "utf-8")
  }

  if (name === "write_file") {
    if (path.basename(String(input.path)) === "SOUL.md") {
      throw new Error("SOUL.md is read-only")
    }
    const safePath = guardPath(String(input.path), false)
    fs.mkdirSync(path.dirname(safePath), { recursive: true })
    fs.writeFileSync(safePath, String(input.content))
    return `Written: ${input.path}`
  }

  if (name === "memory_append") {
    appendMemory(String(input.content))
    return "Remembered."
  }

  if (name === "shell_exec") {
    if (!ctx?.onApproval) return "Error: Shell execution requires approval callback"

    const approved = await ctx.onApproval(String(input.command))
    if (!approved) return "Command denied by user."

    const result = await executeCommand(String(input.command))
    const parts: string[] = []
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`)
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`)
    if (result.timedOut) parts.push("(command timed out after 30s)")
    parts.push(`exit code: ${result.exitCode}`)
    return parts.join("\n")
  }

  if (name === "think") {
    return "[Thought recorded]"
  }

  if (name === "web_search") {
    const results = await exaSearch(String(input.query))
    if (results.length === 0) return "No results found."
    return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`).join("\n\n")
  }

  if (name === "workspace_search") {
    return searchWorkspace(String(input.query))
  }

  if (name === "set_reminder") {
    if (!ctx) return "Error: Reminder requires chat context"
    const id = setReminder(ctx.chatId, String(input.message), Number(input.delay_seconds))
    return `Reminder set (id: ${id}). Will fire in ${input.delay_seconds} seconds.`
  }

  if (name === "list_reminders") {
    if (!ctx) return "Error: Reminder requires chat context"
    const list = listReminders(ctx.chatId)
    if (list.length === 0) return "No active reminders."
    return list.map(r => `- ${r.id}: "${r.message}" (in ${r.remainingSec}s)`).join("\n")
  }

  if (name === "cancel_reminder") {
    const cancelled = cancelReminder(String(input.id))
    return cancelled ? "Reminder cancelled." : "Reminder not found (may have already fired)."
  }

  return `Unknown tool: ${name}`
}
