# MyAgent

Personal AI agent accessible via Telegram. Uses Claude as its brain. Remembers context
across conversations. Reads/writes files in a sandboxed workspace. Single user. MVP.

See `docs/IMPLEMENTATION.md` for the step-by-step build guide with full code examples.

---

## Bash commands

- `npm run dev` — start with hot reload (tsx watch)
- `npm run build` — compile TypeScript to dist/
- `npm run start` — run compiled output
- `npm run typecheck` — run tsc --noEmit (run this after every set of changes)
- `tsx -e "import('./src/config.ts').then(m => console.log(m.config))"` — verify config loads

---

## Project structure

```
src/
  index.ts      ← bot entry point; ACL, rate limit, lane queue all live here
  config.ts     ← env vars validated with zod; crashes fast on bad config
  session.ts    ← Message type (= Anthropic MessageParam) + JSONL storage
  memory.ts     ← MEMORY.md read / append / keyword search
  tools.ts      ← read_file, write_file, memory_append; path guard lives here
  agent.ts      ← system prompt + tool loop + handleMessage
workspace/
  SOUL.md       ← agent personality; read-only to the agent
  MEMORY.md     ← auto-created at runtime; agent appends only
sessions/       ← auto-created at runtime; one .jsonl per userId
```

---

## Code style

- ES modules only (`import/export`). NEVER use `require()`
- TypeScript strict mode. Fix all type errors before finishing
- Use Anthropic SDK types directly: `MessageParam`, `Tool`, `TextBlock`, `ToolUseBlock`
- Never use `as any` — if you need it, fix the types properly
- Prefer `fs.existsSync` + sync fs methods — this is a single-user CLI tool, async fs adds no value
- All file paths through `guardPath()` in tools.ts — except `memory_append`, which hardcodes its path safely in memory.ts

---

## Architecture

```
Telegram (long polling — no exposed port)
       ↓
  [ACL + Rate limit]   in index.ts — unknown users dropped silently, no reply
       ↓
  [Lane queue]         Promise chain per userId in index.ts
       ↓
  [Agent runtime]      agent.ts — system prompt + session + memory → LLM → tool loop
       ↓
  [Tools]              tools.ts — read_file, write_file (workspace only), memory_append
```

No HTTP server. No WebSocket server. No shell execution (v2 feature).

---

## IMPORTANT: Security rules — never violate these

- **ACL check MUST run before any other logic.** Unknown userId = silent drop, no reply at all
- **SOUL.md is read-only.** `guardPath()` throws if the agent tries to write it
- **All file paths MUST go through `guardPath()`** which enforces workspace boundary via `path.resolve()`
- **Tool loop MUST have a hard iteration cap** (MAX_TOOL_ITERATIONS = 10). No unbounded while loops
- **Secrets in .env only.** Never hardcode tokens. Never log them
- **No shell tool in v1.** Do not add it, regardless of how convenient it seems

---

## Environment variables

Required (crash on missing):
```
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...
ALLOWED_USER_IDS=123456789        # comma-separated Telegram user ID integers
```

Optional (have defaults):
```
WORKSPACE_DIR=./workspace
SESSIONS_DIR=./sessions
MODEL=claude-sonnet-4-5-20250929
MAX_MESSAGES_PER_MINUTE=20
```

---

## Common mistakes — avoid these

- Don't call `fs.mkdirSync` inside `appendMessage`. Directories are created once at startup in `index.ts`
- Don't use `userId` as a raw string in filenames. Use `String(userId)` — it's already an integer from Telegraf's typed context
- Don't put `overwriteSession` in session.ts yet — it's dead code until compaction is built (v2)
- Don't forget `process.once("SIGINT")` and `process.once("SIGTERM")` for graceful bot shutdown
- Don't reply to unauthorized users — even "not authorized" confirms the bot exists
- Don't inline large code examples in this file — reference `docs/IMPLEMENTATION.md` instead

---

## Verification checklist

After each step, verify before moving on:

- [ ] `npm run typecheck` passes with zero errors
- [ ] Config: missing env var causes immediate crash with clear message
- [ ] ACL: message from userId NOT in ALLOWED_USER_IDS produces no response
- [ ] Session: `sessions/<userId>.jsonl` created after first message
- [ ] Path guard: `read_file` with path `../../etc/passwd` throws error, not file contents
- [ ] SOUL.md: `write_file` with path `SOUL.md` throws error
- [ ] Tool loop: model responds to "what's 2+2" without triggering any tools
- [ ] Tool loop: "read SOUL.md" triggers read_file tool and returns contents
- [ ] Memory: `memory_append` writes dated entry to `workspace/MEMORY.md`
- [ ] Rate limit: 21 messages in under a minute returns throttle message on message 21
- [ ] Telegram: bot responds to a real message on Telegram
