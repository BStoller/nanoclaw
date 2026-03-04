import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  process.env.ASSISTANT_HAS_OWN_NUMBER === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

const PROJECT_ROOT = process.cwd();
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const AGENTS_DIR = path.resolve(PROJECT_ROOT, 'agents');
export const SESSIONS_DIR = path.resolve(PROJECT_ROOT, 'sessions');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_AGENT_ID = 'main';

export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep agent run alive after last result
export const MAX_CONCURRENT_RUNS = Math.max(
  1,
  parseInt(
    process.env.MAX_CONCURRENT_RUNS ||
      process.env.MAX_CONCURRENT_CONTAINERS ||
      '5',
    10,
  ) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Discord Bot Configuration (optional - configure at least one platform)
// Required for Discord integration:
// - Create a bot at https://discord.com/developers/applications
// - Copy the bot token from Bot > Reset Token
export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';

// Slack Bot Configuration (optional - configure at least one platform)
// Required for Slack integration:
// - Create a Slack app at https://api.slack.com/apps
// - Go to OAuth & Permissions, add scopes: chat:write, im:write, channels:history, groups:history
// - Install app to workspace and copy Bot User OAuth Token (starts with xoxb-)
// - Go to Basic Information to get Signing Secret for webhook verification
export const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
export const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';

// Teams Bot Configuration (optional)
export const TEAMS_APP_ID = process.env.TEAMS_APP_ID || '';
export const TEAMS_APP_PASSWORD = process.env.TEAMS_APP_PASSWORD || '';
export const TEAMS_APP_TENANT_ID = process.env.TEAMS_APP_TENANT_ID || '';

// Google Chat Configuration (optional)
export const GOOGLE_CHAT_CREDENTIALS =
  process.env.GOOGLE_CHAT_CREDENTIALS || '';

// Legacy flag (deprecated - always Discord-only going forward)

// Comma-separated list of authorized user IDs who can trigger /update command
// Format: 1234567890@s.whatsapp.net,discord:123456789012345678
export const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0);
