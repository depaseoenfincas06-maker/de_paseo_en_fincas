# Message Batching Architecture

## Purpose

When a user sends multiple messages quickly (e.g. "Que", "hora", "es?"), the system groups them into a single agent execution instead of responding to each individually.

## How It Works

### Database

- `messages` table has a `pending` boolean column (default: false)
- Messages from non-latest executions are saved with `pending = true`

### Flow

```
Message 1 ("Que") arrives:
  → Agent runs with "Que"
  → Post-agent: Is latest inbound? (checks Chatwoot) → NO (message 2 arrived)
  → Save message as pending (INSERT with pending=true) → skip

Message 2 ("hora") arrives:
  → Agent runs with "hora"  
  → Post-agent: Is latest inbound? → NO (message 3 arrived)
  → Save message as pending → skip

Message 3 ("es?") arrives:
  → Agent runs with "es?"
  → Post-agent: Is latest inbound? → YES
  → Collect pending messages → finds "Que" and "hora"
  → Has pending to re-run? → YES
  → Build aggregated message: "Que\nhora\nes?"
  → Clear pending (UPDATE pending=false)
  → Fire self-webhook with chatInput="Que\nhora\nes?"
  → Webhook Response (this execution ends)

Self-webhook execution:
  → Normalize: source=simulator, chatInput="Que\nhora\nes?"
  → config.current_message reads from $('Normalize inbound payload').item.json.chatInput
  → Agent runs with full "Que\nhora\nes?" as CURRENT_MESSAGE
  → Is latest inbound? → YES (simulator bypasses Chatwoot check)
  → No pending → normal flow → actualizar contexto → send response
```

### Key Nodes

| Node | Purpose |
|------|---------|
| Is latest inbound? | Checks Chatwoot API if this message_id is the latest inbound |
| Collect pending messages | SQL: SELECT aggregated pending from messages table |
| Should update and send? | IF: is_latest_inbound === true (reads from Is latest inbound? node) |
| Save message as pending | SQL: INSERT message with pending=true |
| Clear pending messages | SQL: UPDATE pending=false for this conversation |
| Has pending to re-run? | IF: aggregated_pending is not empty |
| Build aggregated message | Fires self-webhook with combined message |
| Clear pending before re-run | SQL: UPDATE pending=false before re-firing |

### Critical Implementation Details

1. **Is latest inbound?** reads `chatwoot_message_id` from `$('Normalize inbound payload')` and compares with Chatwoot's latest inbound message
2. **Simulator messages** always pass as `is_latest = true` (no Chatwoot to check)
3. **Self-webhook** sends `chatInput` in the body; `config.current_message` reads from `$('Normalize inbound payload').item.json.chatInput` as fallback
4. **Should update and send?** reads `is_latest_inbound` from `$('Is latest inbound?')` directly (not from $json, which loses the field through Postgres nodes)
5. **actualizar contexto1** reads from `$('Finalize offering outbound')` directly (not $json) to avoid losing data through intermediate nodes

### What NOT to Change

- Do NOT remove the `$('Normalize inbound payload').item.json.chatInput` fallback in config.current_message
- Do NOT change `Should update and send?` to read from `$json` instead of the named node reference
- Do NOT change `actualizar contexto1` to read from `$json`
- Do NOT add nodes between `Is latest inbound?` and `Should update and send?` that don't pass through `is_latest_inbound`
- The `pending` column on the messages table must remain — do not remove it in migrations
