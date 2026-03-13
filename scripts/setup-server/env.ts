import fs from 'node:fs/promises';
import { parse } from 'dotenv';
import { setupLogger } from './logger.js';
import type { EnvState } from './types.js';

const SECRET_KEYS = new Set([
  'SLACK_APP_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
]);

export async function readEnvFile(filePath: string): Promise<EnvState> {
  let content = '';

  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'ENOENT') {
      throw error;
    }
  }

  return {
    filePath,
    content,
    values: parse(content),
  };
}

export function requireEnvValue(env: EnvState, key: string): string {
  const value = env.values[key]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key} in ${env.filePath}`,
    );
  }
  return value;
}

export async function updateEnvFile(
  env: EnvState,
  updates: Record<string, string | undefined>,
): Promise<void> {
  const lines = env.content.length > 0 ? env.content.split(/\r?\n/) : [];
  const remainingKeys = new Set(Object.keys(updates));

  const nextLines = lines.map((line) => {
    for (const [key, value] of Object.entries(updates)) {
      const pattern = new RegExp(`^\\s*(?:export\\s+)?${escapeRegex(key)}=`);
      if (!pattern.test(line)) {
        continue;
      }

      remainingKeys.delete(key);
      if (value === undefined) {
        return line;
      }

      return `${key}=${formatEnvValue(value)}`;
    }

    return line;
  });

  for (const key of remainingKeys) {
    const value = updates[key];
    if (value === undefined) {
      continue;
    }

    nextLines.push(`${key}=${formatEnvValue(value)}`);
  }

  const nextContent = `${trimTrailingBlankLines(nextLines).join('\n')}\n`;
  await fs.writeFile(env.filePath, nextContent, {
    encoding: 'utf8',
    mode: 0o600,
  });

  env.content = nextContent;
  env.values = parse(nextContent);

  setupLogger.info(
    {
      envFile: env.filePath,
      keys: Object.keys(updates),
    },
    'Updated environment file',
  );
}

export function maskSecret(
  key: string,
  value: string | undefined,
): string | undefined {
  if (!value) {
    return value;
  }

  if (!SECRET_KEYS.has(key)) {
    return value;
  }

  if (value.length <= 8) {
    return '***';
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') {
    end -= 1;
  }

  return lines.slice(0, end);
}
