import { execFile } from "child_process"
import path from "path"
import { config } from "./config.js"

const MAX_OUTPUT = 50 * 1024 // 50KB
const DEFAULT_TIMEOUT = 30_000

export interface ShellResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

export function executeCommand(
  command: string,
  cwd?: string,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<ShellResult> {
  const workDir = cwd ?? path.resolve(config.WORKSPACE_DIR)

  return new Promise((resolve) => {
    execFile(
      "/bin/sh",
      ["-c", command],
      {
        cwd: workDir,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT,
      },
      (error, stdout, stderr) => {
        const timedOut = error?.killed === true

        let exitCode = 0
        if (error) {
          exitCode = timedOut ? 124 : (typeof error.code === "number" ? error.code : 1)
        }

        const truncate = (s: string) =>
          s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n[truncated]" : s

        resolve({
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          exitCode,
          timedOut,
        })
      }
    )
  })
}
