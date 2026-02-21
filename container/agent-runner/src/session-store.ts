import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { JSONValue, ModelMessage, ToolCallPart, ToolResultPart } from 'ai';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';

const STORE_DIR = path.join('/workspace/group', '.nanoclaw');
const DB_PATH = path.join(STORE_DIR, 'conversation.db');
const SESSION_PATH = path.join(STORE_DIR, 'session.json');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(STORE_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
      content TEXT,
      tool_calls TEXT,
      tool_results TEXT,
      token_count INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_session ON conversation_history(group_folder, session_id);
    CREATE INDEX IF NOT EXISTS idx_conversation_created ON conversation_history(created_at);
  `);
  return db;
}

export function getOrCreateSessionId(groupFolder: string): string {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  if (fs.existsSync(SESSION_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf-8')) as {
        sessionId?: string;
      };
      if (data.sessionId) return data.sessionId;
    } catch {
      // ignore corrupted session file
    }
  }

  const sessionId = randomUUID();
  fs.writeFileSync(
    SESSION_PATH,
    JSON.stringify({ sessionId, groupFolder }, null, 2),
  );
  return sessionId;
}

export function loadMessages(
  groupFolder: string,
  sessionId: string,
): ModelMessage[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT role, content, tool_calls, tool_results
       FROM conversation_history
       WHERE group_folder = ? AND session_id = ?
       ORDER BY id ASC`,
    )
    .all(groupFolder, sessionId) as Array<{
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | null;
    tool_calls: string | null;
    tool_results: string | null;
  }>;

  return rows.map((row) => deserializeMessage(row));
}

export function saveMessage(
  groupFolder: string,
  sessionId: string,
  message: ModelMessage,
  tokenCount?: number | null,
): void {
  const database = getDb();
  const { role, content, toolCalls, toolResults } = serializeMessage(message);
  database
    .prepare(
      `INSERT INTO conversation_history (group_folder, session_id, role, content, tool_calls, tool_results, token_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      groupFolder,
      sessionId,
      role,
      content,
      toolCalls,
      toolResults,
      tokenCount ?? null,
      new Date().toISOString(),
    );
}

export function getSessionTokenCount(sessionId: string): number {
  const database = getDb();
  const row = database
    .prepare(
      `SELECT SUM(token_count) as total
       FROM conversation_history
       WHERE session_id = ? AND token_count IS NOT NULL`,
    )
    .get(sessionId) as { total: number | null } | undefined;
  return row?.total ?? 0;
}

export function replaceSessionMessages(
  groupFolder: string,
  sessionId: string,
  messages: ModelMessage[],
): void {
  const database = getDb();
  const deleteStmt = database.prepare(
    `DELETE FROM conversation_history WHERE group_folder = ? AND session_id = ?`,
  );
  const insertStmt = database.prepare(
    `INSERT INTO conversation_history (group_folder, session_id, role, content, tool_calls, tool_results, token_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const now = new Date().toISOString();
  const insertMany = database.transaction(() => {
    deleteStmt.run(groupFolder, sessionId);
    for (const message of messages) {
      const { role, content, toolCalls, toolResults } =
        serializeMessage(message);
      insertStmt.run(
        groupFolder,
        sessionId,
        role,
        content,
        toolCalls,
        toolResults,
        null,
        now,
      );
    }
  });

  insertMany();
}

function serializeMessage(message: ModelMessage): {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  toolCalls: string | null;
  toolResults: string | null;
} {
  const role = message.role as 'user' | 'assistant' | 'system' | 'tool';
  const content = extractContentText(message);
  const toolCalls =
    role === 'assistant' && Array.isArray(message.content)
      ? serializeToolCalls(message.content)
      : null;
  const toolResults =
    role === 'tool' ? JSON.stringify(message.content ?? []) : null;

  return {
    role,
    content,
    toolCalls,
    toolResults,
  };
}

function deserializeMessage(row: {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls: string | null;
  tool_results: string | null;
}): ModelMessage {
  if (row.role === 'tool') {
    const toolResults = normalizeToolResults(row.tool_results, row.content);
    return {
      role: 'tool',
      content: toolResults,
    };
  }

  const message: ModelMessage = {
    role: row.role,
    content: row.content || '',
  };

  if (row.tool_calls) {
    (message as { toolCalls?: unknown }).toolCalls = JSON.parse(row.tool_calls);
  }

  return message;
}

function extractContentText(message: ModelMessage): string | null {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!content) return null;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (isTextPart(part)) {
          return part.text ?? '';
        }
        if (isToolResultPart(part)) {
          return toolOutputToText(part.output);
        }
        return '';
      })
      .join('')
      .trim();
  }
  return String(content);
}

function serializeToolCalls(content: ModelMessage['content']): string | null {
  if (!Array.isArray(content)) return null;
  const toolCalls = content.filter(isToolCallPart).map((part) => ({
    toolName: part.toolName,
    toolCallId: part.toolCallId,
    input: part.input,
  }));
  return toolCalls.length > 0 ? JSON.stringify(toolCalls) : null;
}

function normalizeToolResults(
  toolResultsJson: string | null,
  fallbackContent: string | null,
): ToolResultPart[] {
  if (!toolResultsJson) {
    return fallbackContent ? [createFallbackToolResult(fallbackContent)] : [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(toolResultsJson);
  } catch {
    return fallbackContent ? [createFallbackToolResult(fallbackContent)] : [];
  }

  if (Array.isArray(parsed)) {
    const normalized = parsed
      .map(normalizeToolResultPart)
      .filter((part): part is ToolResultPart => part != null);
    if (normalized.length > 0) return normalized;
  }

  if (parsed && typeof parsed === 'object') {
    const maybe = parsed as {
      toolName?: unknown;
      toolCallId?: unknown;
      result?: unknown;
      output?: unknown;
    };
    if (
      typeof maybe.toolName === 'string' &&
      typeof maybe.toolCallId === 'string'
    ) {
      return [
        {
          type: 'tool-result',
          toolName: maybe.toolName,
          toolCallId: maybe.toolCallId,
          output: toToolResultOutput(
            'output' in maybe ? maybe.output : maybe.result,
          ),
        },
      ];
    }
  }

  return fallbackContent ? [createFallbackToolResult(fallbackContent)] : [];
}

function normalizeToolResultPart(part: unknown): ToolResultPart | null {
  if (!part || typeof part !== 'object') return null;
  const maybe = part as {
    type?: unknown;
    toolName?: unknown;
    toolCallId?: unknown;
    result?: unknown;
    output?: unknown;
  };
  if (
    (maybe.type === 'tool-result' || maybe.type === undefined) &&
    typeof maybe.toolName === 'string' &&
    typeof maybe.toolCallId === 'string'
  ) {
    return {
      type: 'tool-result',
      toolName: maybe.toolName,
      toolCallId: maybe.toolCallId,
      output: toToolResultOutput(
        'output' in maybe ? maybe.output : maybe.result,
      ),
    };
  }
  return null;
}

function createFallbackToolResult(content: string): ToolResultPart {
  return {
    type: 'tool-result',
    toolName: 'unknown',
    toolCallId: 'unknown',
    output: { type: 'text', value: content },
  };
}

function isTextPart(part: unknown): part is { text: string | undefined } {
  return !!part && typeof part === 'object' && 'text' in part;
}

function isToolCallPart(part: unknown): part is ToolCallPart {
  return (
    !!part &&
    typeof part === 'object' &&
    (part as { type?: unknown }).type === 'tool-call' &&
    typeof (part as { toolName?: unknown }).toolName === 'string' &&
    typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
  );
}

function isToolResultPart(part: unknown): part is ToolResultPart {
  return (
    !!part &&
    typeof part === 'object' &&
    (part as { type?: unknown }).type === 'tool-result' &&
    typeof (part as { toolName?: unknown }).toolName === 'string' &&
    typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
  );
}

function toToolResultOutput(value: unknown): ToolResultOutput {
  if (isToolResultOutput(value)) return value;
  if (typeof value === 'string') return { type: 'text', value };
  if (isJsonValue(value)) return { type: 'json', value };

  try {
    const serialized = JSON.stringify(value);
    if (serialized != null) {
      return { type: 'text', value: serialized };
    }
  } catch {
    // ignore
  }

  return { type: 'text', value: String(value) };
}

function isToolResultOutput(value: unknown): value is ToolResultOutput {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  if (typeof type !== 'string') return false;
  if ('value' in (value as object)) return true;
  return type === 'execution-denied';
}

function toolOutputToText(output: ToolResultOutput): string {
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      try {
        return JSON.stringify(output.value);
      } catch {
        return String(output.value);
      }
    case 'execution-denied':
      return output.reason ?? 'Execution denied.';
    case 'content':
      return output.value
        .map((part: { type: string; text?: string }) =>
          part.type === 'text' ? (part.text ?? '') : '',
        )
        .join('')
        .trim();
    default:
      return '';
  }
}

function isJsonValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }

  return false;
}
