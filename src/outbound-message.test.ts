import { describe, expect, it } from 'vitest';

import {
  DISCORD_MAX_MESSAGE_LENGTH,
  splitOutboundMessageForPlatform,
  splitTextIntoChunks,
} from './outbound-message.js';

describe('splitTextIntoChunks', () => {
  it('keeps short messages intact', () => {
    expect(splitTextIntoChunks('hello', 10)).toEqual(['hello']);
  });

  it('splits long messages without exceeding the max length', () => {
    const text = Array.from({ length: 800 }, (_, idx) => `word-${idx}`).join(
      ' ',
    );
    const chunks = splitTextIntoChunks(text, 120);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });

  it('falls back to hard splits when no separator exists', () => {
    const text = 'x'.repeat(250);
    const chunks = splitTextIntoChunks(text, 100);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(100);
    expect(chunks[1]).toHaveLength(100);
    expect(chunks[2]).toHaveLength(50);
  });
});

describe('splitOutboundMessageForPlatform', () => {
  it('only chunks Discord messages', () => {
    const text = 'x'.repeat(DISCORD_MAX_MESSAGE_LENGTH + 25);

    expect(splitOutboundMessageForPlatform('discord', text)).toHaveLength(2);
    expect(splitOutboundMessageForPlatform('slack', text)).toEqual([text]);
  });
});
