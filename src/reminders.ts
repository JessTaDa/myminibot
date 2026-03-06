export type SendMessageFn = (chatId: number, text: string) => Promise<void>

interface Reminder {
  id: string
  chatId: number
  message: string
  fireAt: number
  timer: ReturnType<typeof setTimeout>
}

const reminders = new Map<string, Reminder>()
let sendFn: SendMessageFn | null = null

const MAX_DELAY_SEC = 86_400 // 24 hours

export function initReminders(send: SendMessageFn): void {
  sendFn = send
}

export function setReminder(chatId: number, message: string, delaySec: number): string {
  if (!sendFn) throw new Error("Reminders not initialized")
  if (delaySec <= 0) throw new Error("Delay must be positive")
  if (delaySec > MAX_DELAY_SEC) throw new Error(`Delay cannot exceed ${MAX_DELAY_SEC} seconds (24 hours)`)

  const id = `r_${chatId}_${Date.now()}`
  const fireAt = Date.now() + delaySec * 1000

  const timer = setTimeout(async () => {
    reminders.delete(id)
    try {
      await sendFn!(chatId, `Reminder: ${message}`)
    } catch (err) {
      console.error("Failed to send reminder:", err)
    }
  }, delaySec * 1000)

  timer.unref()

  reminders.set(id, { id, chatId, message, fireAt, timer })
  return id
}

export function listReminders(chatId: number): { id: string; message: string; remainingSec: number }[] {
  const now = Date.now()
  const results: { id: string; message: string; remainingSec: number }[] = []

  for (const r of reminders.values()) {
    if (r.chatId === chatId) {
      results.push({
        id: r.id,
        message: r.message,
        remainingSec: Math.max(0, Math.round((r.fireAt - now) / 1000)),
      })
    }
  }

  return results.sort((a, b) => a.remainingSec - b.remainingSec)
}

export function cancelReminder(id: string): boolean {
  const r = reminders.get(id)
  if (!r) return false
  clearTimeout(r.timer)
  reminders.delete(id)
  return true
}
