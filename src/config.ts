import { z } from "zod"
import "dotenv/config"

const schema = z.object({
  ANTHROPIC_API_KEY:  z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_USER_IDS:   z.string().min(1).transform(s =>
    new Set(
      s.split(",")
        .map(id => parseInt(id.trim(), 10))
        .filter(n => !isNaN(n))
    )
  ).refine(set => set.size > 0, "ALLOWED_USER_IDS must contain at least one valid integer"),
  WORKSPACE_DIR:            z.string().default("./workspace"),
  SESSIONS_DIR:             z.string().default("./sessions"),
  MODEL:                    z.string().default("claude-sonnet-4-5-20250929"),
  MAX_MESSAGES_PER_MINUTE:  z.coerce.number().default(20),
  COMPACTION_THRESHOLD:     z.coerce.number().default(80),
  COMPACTION_KEEP:          z.coerce.number().default(40),
  EXA_API_KEY:              z.string().optional(),
  MAX_FILE_SIZE:            z.coerce.number().default(10_485_760),
})

export const config = schema.parse(process.env)
