# MyAgent

A self-hosted personal AI agent that lives in your Telegram. Powered by Claude. Runs on your own machine.

You text it like a friend. It remembers context, works with files, searches the web, handles photos, runs shell commands (with your approval), and sets reminders.

---

## What it does

- **Chat via Telegram** using Claude (Sonnet by default), with streaming replies
- **Remember across conversations** — session history persists, important facts get saved to long-term memory, and long sessions are automatically compacted into summaries
- **Work with files** — reads and writes files in a sandboxed workspace directory
- **Search the workspace** — TF-IDF keyword search across all workspace files
- **Search the web** — queries Exa for current information (optional, needs API key)
- **Handle photos and documents** — send images or PDFs directly in chat for analysis
- **Run shell commands** — executes commands on the host machine, each requiring explicit approval via inline buttons
- **Set reminders** — in-memory timers that message you after a delay (max 24h)

---

## How it works

```
You (Telegram)  — text, photos, PDFs
      ↓
 ACL check        — unknown users dropped silently
      ↓
 Rate limit       — 20/min default
      ↓
 Lane queue       — messages process one at a time, in order
      ↓
 Agent runtime    — Claude + session history + memory + tools
      ↓
 Tool loop        — up to 10 iterations per message
      ↓
 Reply            — streamed back to Telegram, edited in-place
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
git clone https://github.com/JessTaDa/myminibot.git
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

## Tools

The agent has access to these tools (exposed to Claude as function calls):

| Tool | Description |
|---|---|
| `read_file` | Read a file from the workspace |
| `write_file` | Write/create a file in the workspace |
| `memory_append` | Save a note to long-term memory |
| `shell_exec` | Run a shell command (requires user approval) |
| `think` | Private step-by-step reasoning |
| `workspace_search` | TF-IDF search across workspace files |
| `web_search` | Search the web via Exa (optional) |
| `set_reminder` | Schedule a message after a delay |
| `list_reminders` | List active reminders |
| `cancel_reminder` | Cancel a reminder by ID |

---

## Project structure

```
myagent/
├── src/
│   ├── index.ts            — bot, ACL, rate limiting, message queue, photo/document handling
│   ├── config.ts           — environment variable validation
│   ├── agent.ts            — Claude API loop + tool execution
│   ├── session.ts          — per-user conversation history (JSONL)
│   ├── compaction.ts       — session summarization when history gets long
│   ├── memory.ts           — long-term memory (MEMORY.md)
│   ├── tools.ts            — tool definitions + dispatch with path-traversal protection
│   ├── shell.ts            — shell command execution with timeout and output cap
│   ├── stream.ts           — streaming replies via Telegram message editing
│   ├── workspace-search.ts — TF-IDF search across workspace files
│   ├── web-search.ts       — Exa web search integration
│   └── reminders.ts        — in-memory reminder scheduling
├── workspace/
│   ├── SOUL.md             — agent personality (edit this)
│   └── MEMORY.md           — auto-created; agent's long-term notes
└── sessions/               — auto-created; one file per user
```

---

## Security

- **Single-user by design.** Only Telegram user IDs listed in `ALLOWED_USER_IDS` can interact with the bot. Everyone else gets no response.
- **No exposed ports.** Uses Telegram long polling — your machine never accepts inbound connections.
- **Sandboxed file access.** The agent can only read and write files inside the `workspace/` directory. Path traversal and symlink escape attempts are blocked.
- **Agent can't modify its own rules.** `SOUL.md` is hardcoded as read-only.
- **Shell commands require approval.** Every `shell_exec` shows the command via inline keyboard buttons. 60-second auto-deny timeout.
- **Rate limited.** 20 messages per minute by default (configurable).
- **Secrets in env only.** `.env` is gitignored.

---

## Configuration

All configuration is via environment variables:

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Your Anthropic API key |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Token from @BotFather |
| `ALLOWED_USER_IDS` | Yes | — | Comma-separated Telegram user IDs |
| `WORKSPACE_DIR` | | `./workspace` | Where the agent can read/write files |
| `SESSIONS_DIR` | | `./sessions` | Where conversation history is stored |
| `MODEL` | | `claude-sonnet-4-5-20250929` | Anthropic model to use |
| `MAX_MESSAGES_PER_MINUTE` | | `20` | Rate limit per user |
| `COMPACTION_THRESHOLD` | | `80` | Session messages before compaction triggers |
| `COMPACTION_KEEP` | | `40` | Recent messages to keep after compaction |
| `EXA_API_KEY` | | — | Exa API key for web search (omit to disable) |
| `MAX_FILE_SIZE` | | `10485760` | Max upload size in bytes (10MB) |

---

## Roadmap

- [ ] Browser tool with semantic page snapshots
- [ ] Persistent reminders (survive restarts)
- [ ] Discord / Slack channel adapters
