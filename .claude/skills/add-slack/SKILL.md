# Add Slack Channel

This skill adds Slack support to NanoClaw. Slack can be used alongside Discord or as a standalone channel.

## Prerequisites

The codebase must already have Discord support (from `/add-discord`). The Slack adapter builds on the same multi-adapter infrastructure.

## Phase 1: Pre-flight

### Check if Discord is already set up

Ensure Discord is configured or you're adding both simultaneously. The Slack implementation requires the multi-adapter infrastructure that Discord sets up.

### Ask the user

1. **Mode**: Replace Discord or add alongside it?
   - Replace → will remove Discord-only mode, Slack becomes primary
   - Alongside → both channels active (default)

2. **Do they already have Slack app credentials?** If yes, collect them now. If no, we'll create them in Phase 3.

## Phase 2: Apply Code Changes

### Install Slack adapter package

```bash
npm install @chat-adapter/slack
```

### Update chat-sdk-bot.ts

Add the Slack adapter import and initialization:

1. Import `createSlackAdapter` from `@chat-adapter/slack`
2. Import `SLACK_BOT_TOKEN` from `./config.js`
3. Conditionally add Slack adapter in `createChatSdkBot()` when token is set
4. Start Slack listener alongside Discord listener in initialization

### Update .env.example

Ensure `.env.example` documents both Discord and Slack variables:

- `DISCORD_BOT_TOKEN` - Discord bot token
- `SLACK_BOT_TOKEN` - Slack bot OAuth token (xoxb-...)
- `SLACK_SIGNING_SECRET` - Slack app signing secret

## Phase 3: Setup

### Create Slack App (if needed)

If the user doesn't have a Slack app, tell them:

> I need you to create a Slack app:
>
> 1. Go to [Slack API](https://api.slack.com/apps) and click **Create New App**
> 2. Choose **From scratch** and give it a name (e.g., "Andy Assistant")
> 3. Select your workspace and click **Create App**
> 4. Go to **OAuth & Permissions** in the left sidebar
> 5. Under **Scopes** > **Bot Token Scopes**, add:
>    - `chat:write` - Send messages
>    - `im:write` - Send direct messages
>    - `channels:history` - Read public channel messages
>    - `groups:history` - Read private channel messages
>    - `app_mentions:read` - Read when bot is mentioned
> 6. Click **Install to Workspace** at the top
> 7. Copy the **Bot User OAuth Token** (starts with `xoxb-`)
> 8. Go to **Basic Information** in the left sidebar
> 9. Scroll down to **Signing Secret** and click **Show**
> 10. Copy the Signing Secret

Wait for the user to provide:

- `SLACK_BOT_TOKEN` (starts with `xoxb-`)
- `SLACK_SIGNING_SECRET`

### Configure environment

Add to `.env`:

```bash
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
```

If using Slack alongside Discord, also keep Discord config:

```bash
DISCORD_BOT_TOKEN=your-discord-token-here
```

Sync to container environment:

```bash
cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Phase 4: Registration

### Get Channel ID

Tell the user:

> To get the Slack channel ID for registration:
>
> 1. In Slack, open the channel you want the bot to respond in
> 2. Click the channel name at the top to open channel details
> 3. Scroll down and copy the **Channel ID** (starts with C...)
>
> The channel ID will look like `C1234567890`.

For direct messages, the format is `slack:<team-id>:D<channel-id>`.

Wait for the user to provide the channel ID.

### Invite bot to channel

> Important: You must invite the bot to the channel:
>
> 1. In the Slack channel, type `/invite @YourBotName`
> 2. Or click the channel name > Settings > Add apps > Select your bot

### Register the channel

Use the IPC register flow or register directly. The channel ID format for Slack is `slack:<team-id>:<channel-id>`.

For a main channel (responds to all messages, uses the `main` folder):

```typescript
registerGroup('slack:<team-id>:<channel-id>', {
  name: '#<channel-name>',
  folder: 'main',
  trigger: `@${ASSISTANT_NAME}`,
  added_at: new Date().toISOString(),
  requiresTrigger: false,
});
```

For additional channels (trigger-only):

```typescript
registerGroup('slack:<team-id>:<channel-id>', {
  name: '#<channel-name>',
  folder: '<folder-name>',
  trigger: `@${ASSISTANT_NAME}`,
  added_at: new Date().toISOString(),
  requiresTrigger: true,
});
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message in your registered Slack channel:
>
> - For main channel: Any message works (bot will respond to all)
> - For non-main: @mention the bot (e.g., `@Andy hello`)
>
> The bot should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

## Troubleshooting

### Bot not responding

1. Check `SLACK_BOT_TOKEN` is set in `.env` AND synced to `data/env/env`
2. Verify the bot has been invited to the channel: run `/invite @BotName` in the channel
3. Check channel is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'slack:%'"`
4. For non-main channels: message must include trigger pattern (@mention the bot)
5. Service is running: `launchctl list | grep nanoclaw`

### Bot can't read messages

Ensure the Slack app has the required scopes:

- `channels:history` for public channels
- `groups:history` for private channels

Reinstall the app to workspace after adding scopes.

### Bot responds but with errors

Check the logs for adapter errors. The Slack adapter may need webhook configuration for some features.

### Getting "not_in_channel" error

The bot hasn't been invited to the channel. Use `/invite @BotName` in the channel.

## After Setup

The Slack bot supports:

- Text messages in registered channels
- @mention triggers
- Direct messages
- Message threading for conversations
- File attachments (handled by Chat SDK)

## Environment Variables Summary

| Variable               | Required | Description                                 |
| ---------------------- | -------- | ------------------------------------------- |
| `SLACK_BOT_TOKEN`      | Yes      | Bot User OAuth Token (xoxb-...)             |
| `SLACK_SIGNING_SECRET` | Yes      | App signing secret for webhook verification |
| `DISCORD_BOT_TOKEN`    | No\*     | Discord token (if using alongside)          |

\*At least one of `SLACK_BOT_TOKEN` or `DISCORD_BOT_TOKEN` must be set

## Thread ID Format

Slack thread IDs follow the pattern: `slack:<team-id>:<channel-id>`

Examples:

- Public channel: `slack:T1234567890:C1234567890`
- Direct message: `slack:T1234567890:D1234567890`
- Private channel: `slack:T1234567890:G1234567890`
