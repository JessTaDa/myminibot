# MyAgent 🤖

A self-hosted personal AI agent that lives in your Telegram. Powered by Claude. Runs on your own machine.

You text it like a friend. It remembers your conversations, reads and writes files in a sandboxed workspace, and actually does things — not just talks.

---

## What it does

- **Responds intelligently** via Telegram using Claude (Sonnet by default)
- **Remembers across conversations** — session history persists between restarts, and important facts get saved to long-term memory
- **Works with files** — reads and writes files in a sandboxed workspace directory
- **Stays yours** — runs on your hardware, your API keys, no third-party services storing your data

## What it doesn't do (yet)

This is a focused MVP. Shell execution, browser automation, scheduling, and multi-channel support are planned for v2. The goal here is to get the core loop right first.

---

## How it works

```
You (Telegram)
      ↓
 ACL check        — unknown users are dropped silently
      ↓
 Lane queue       — your messages process one at a time, in order
      ↓
 Agent runtime    — Claude reads your message, session history, and relevant memories
      ↓
 Tool loop        — Claude can read/write files and save notes to memory
      ↓
 Reply            — streamed back to Telegram
```

Everything runs over Telegram's long-polling — no open ports, no web server.

---

## Requirements

- Node.js 22+
- An [Anthropic API key](https://console.anthropic.com/)
- A Telegram bot token (create one via [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (get it from [@userinfobot](https://t.me/userinfobot))

---

## Setup

**1. Clone and install**

```bash
git clone <your-repo>
cd myagent
npm install
```

**2. Create your `.env` file**

```
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=...
ALLOWED_USER_IDS=123456789
```

`ALLOWED_USER_IDS` is a comma-separated list of Telegram user IDs that are allowed to talk to the bot. Anyone not on this list is silently ignored.

**3. Customise your agent** (optional)

Edit `workspace/SOUL.md` to give your agent a name, personality, and any specific instructions. This is loaded as the system prompt on every conversation.

**4. Run**

```bash
npm run dev      # development, with hot reload
npm run build    # compile
npm run start    # run compiled output
```

---

## Project structure

```
myagent/
├── src/
│   ├── index.ts      — bot, ACL, rate limiting, message queue
│   ├── config.ts     — environment variable validation
│   ├── session.ts    — per-user conversation history (JSONL)
│   ├── memory.ts     — long-term memory (MEMORY.md)
│   ├── tools.ts      — file tools with path-traversal protection
│   └── agent.ts      — Claude API loop + tool execution
├── workspace/
│   ├── SOUL.md       — agent personality (edit this)
│   └── MEMORY.md     — auto-created; agent's long-term notes
├── sessions/         — auto-created; one file per user
└── docs/
    └── IMPLEMENTATION.md  — full build guide
```

---

## Security

- **Single-user by design.** Only Telegram user IDs listed in `ALLOWED_USER_IDS` can interact with the bot. Everyone else gets no response.
- **No exposed ports.** Uses Telegram long polling — your machine never accepts inbound connections.
- **Sandboxed file access.** The agent can only read and write files inside the `workspace/` directory. Path traversal attempts are blocked at the code level.
- **Agent can't modify its own rules.** `SOUL.md` is hardcoded as read-only — the agent cannot overwrite its own personality or instructions.
- **Rate limited.** Capped at 20 messages per minute by default (configurable).
- **Secrets in env only.** No config files with tokens. `.env` is gitignored.

---

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | — | Your Anthropic API key |
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Token from @BotFather |
| `ALLOWED_USER_IDS` | ✅ | — | Comma-separated Telegram user IDs |
| `WORKSPACE_DIR` | | `./workspace` | Where the agent can read/write files |
| `SESSIONS_DIR` | | `./sessions` | Where conversation history is stored |
| `MODEL` | | `claude-sonnet-4-5-20250929` | Anthropic model to use |
| `MAX_MESSAGES_PER_MINUTE` | | `20` | Rate limit per user |

---

## Roadmap

- [ ] Shell command execution (with per-command approval)
- [ ] Session compaction for very long conversations
- [ ] Streaming replies to Telegram as they arrive
- [ ] Browser tool with semantic page snapshots
- [ ] Discord / Slack channel adapters
