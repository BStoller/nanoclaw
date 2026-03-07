import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAgent } = vi.hoisted(() => ({
  getAgent: vi.fn(),
}));

const { resolveAgentId } = vi.hoisted(() => ({
  resolveAgentId: vi.fn(),
}));

vi.mock('../../db.js', () => ({
  getAgent,
}));

vi.mock('../../router.js', () => ({
  resolveAgentId,
}));

import { resolveVoiceAgent } from './route-resolver.js';

describe('resolveVoiceAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a specific resolved agent when present', async () => {
    resolveAgentId.mockResolvedValue('ops');
    getAgent.mockResolvedValue({ id: 'ops', name: 'Ops' });

    await expect(
      resolveVoiceAgent('voice:discord:guild:channel'),
    ).resolves.toEqual({
      id: 'ops',
      name: 'Ops',
    });
    expect(getAgent).toHaveBeenCalledWith('ops');
  });

  it('falls back to the main agent when no voice route exists', async () => {
    resolveAgentId.mockResolvedValue(null);
    getAgent.mockResolvedValue({ id: 'main', name: 'Main' });

    await expect(
      resolveVoiceAgent('voice:discord:guild:channel'),
    ).resolves.toEqual({
      id: 'main',
      name: 'Main',
    });
    expect(getAgent).toHaveBeenCalledWith('main');
  });
});
