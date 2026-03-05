import fs from "fs"
import path from "path"
import type { Tool } from "@anthropic-ai/sdk/resources/messages"
import { config } from "./config.js"
import { appendMemory } from "./memory.js"
import { executeCommand } from "./shell.js"

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

export const tools: Tool[] = [
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
]

export type ApprovalCallback = (command: string) => Promise<boolean>

export async function executeTool(
  name: string,
  input: Record<string, string>,
  onApproval?: ApprovalCallback
): Promise<string> {
  if (name === "read_file") {
    const safePath = guardPath(input.path, true)
    if (!fs.existsSync(safePath)) return `File not found: ${input.path}`
    return fs.readFileSync(safePath, "utf-8")
  }

  if (name === "write_file") {
    if (path.basename(input.path) === "SOUL.md") {
      throw new Error("SOUL.md is read-only")
    }
    const safePath = guardPath(input.path, false)
    fs.mkdirSync(path.dirname(safePath), { recursive: true })
    fs.writeFileSync(safePath, input.content)
    return `Written: ${input.path}`
  }

  if (name === "memory_append") {
    appendMemory(input.content)
    return "Remembered."
  }

  if (name === "shell_exec") {
    if (!onApproval) return "Error: Shell execution requires approval callback"

    const approved = await onApproval(input.command)
    if (!approved) return "Command denied by user."

    const result = await executeCommand(input.command)
    const parts: string[] = []
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`)
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`)
    if (result.timedOut) parts.push("(command timed out after 30s)")
    parts.push(`exit code: ${result.exitCode}`)
    return parts.join("\n")
  }

  return `Unknown tool: ${name}`
}
