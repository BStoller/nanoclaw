import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getAllAgents } = vi.hoisted(() => ({
  getAllAgents: vi.fn(async () => ({})),
}));

vi.mock('../../db.js', () => ({
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  getAllTasks: vi.fn(async () => []),
  getTaskById: vi.fn(async () => null),
  updateTask: vi.fn(),
  setRoute: vi.fn(),
  getAllAgents,
  setAgent: vi.fn(),
}));

vi.mock('../../router.js', () => ({
  resolveAgentId: vi.fn(async () => null),
  isNoReply: (text: string) => text.trim() === 'NO_REPLY',
}));

vi.mock('../model-config.js', () => ({
  getAvailableModels: vi.fn(async () => []),
  getStaticAvailableModels: vi.fn(() => []),
  isModelConfigured: vi.fn(async () => true),
}));

vi.mock('../../task-scheduler.js', () => ({
  runTaskNow: vi.fn(async () => undefined),
}));

vi.mock('../../instance.js', () => ({
  getInstanceInfo: vi.fn(() => ({
    id: 'instance-1',
    name: 'Test Instance',
    createdAt: '2026-03-13T00:00:00.000Z',
  })),
}));

import { createNanoClawTools } from './nanoclaw.js';

describe('createNanoClawTools delegate_to_agent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates work to another agent in an isolated context', async () => {
    const runAgent = vi.fn(async () => ({
      status: 'success' as const,
      result: 'Background answer',
    }));

    const tools = createNanoClawTools(
      {
        sendMessage: async () => undefined,
        schedulerDeps: {
          agents: async () => ({
            helper: {
              id: 'helper',
              folder: 'helper',
              name: 'Helper',
              trigger: '@helper',
              added_at: '2026-03-13T00:00:00.000Z',
              isMain: false,
              modelProvider: 'opencode-zen',
              modelName: 'gpt-5.4',
            },
          }),
          getSessions: async () => ({}),
          runAgent,
          sendMessage: async () => undefined,
        },
      },
      {
        chatJid: 'discord:guild:thread',
        agentId: 'main',
        isMain: true,
      },
    );

    const result = await (tools.delegate_to_agent as any).execute({
      agent_id: 'helper',
      prompt: 'Research this and report back',
    });

    expect(result).toMatchObject({
      ok: true,
      agentId: 'helper',
      result: 'Background answer',
    });
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'helper',
        chatJid: expect.stringMatching(
          /^delegated:discord:guild:thread:delegated-/,
        ),
        delegationDepth: 1,
        modelProvider: 'opencode-zen',
        modelName: 'gpt-5.4',
      }),
    );
    expect(runAgent).toHaveBeenCalledTimes(1);
    const delegatedInput = (runAgent as any).mock.calls[0][0] as {
      prompt: string;
    };
    expect(delegatedInput.prompt).toContain('[DELEGATED TASK');
    expect(delegatedInput.prompt).toContain('Research this and report back');
  });

  it('returns an error when the target agent does not exist', async () => {
    const tools = createNanoClawTools(
      {
        sendMessage: async () => undefined,
        schedulerDeps: {
          agents: async () => ({}),
          getSessions: async () => ({}),
          runAgent: vi.fn(async () => ({
            status: 'success' as const,
            result: 'unused',
          })),
          sendMessage: async () => undefined,
        },
      },
      {
        chatJid: 'discord:guild:thread',
        agentId: 'main',
        isMain: true,
      },
    );

    await expect(
      (tools.delegate_to_agent as any).execute({
        agent_id: 'missing',
        prompt: 'Do work',
      }),
    ).resolves.toEqual({ error: 'Agent "missing" not found.' });
  });

  it('blocks nested delegation beyond the depth limit', async () => {
    const runAgent = vi.fn();
    const tools = createNanoClawTools(
      {
        sendMessage: async () => undefined,
        schedulerDeps: {
          agents: async () => ({
            helper: {
              id: 'helper',
              folder: 'helper',
              name: 'Helper',
              trigger: '@helper',
              added_at: '2026-03-13T00:00:00.000Z',
            },
          }),
          getSessions: async () => ({}),
          runAgent,
          sendMessage: async () => undefined,
        },
      },
      {
        chatJid: 'discord:guild:thread',
        agentId: 'helper',
        isMain: false,
        delegationDepth: 1,
      },
    );

    const result = await (tools.delegate_to_agent as any).execute({
      agent_id: 'helper',
      prompt: 'Delegate again',
    });

    expect(result).toEqual({
      error:
        'Delegation depth limit reached (1). Complete the work directly instead of delegating again.',
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('normalizes empty or NO_REPLY delegated results', async () => {
    const runAgent = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'success' as const,
        result: '',
      })
      .mockResolvedValueOnce({
        status: 'success' as const,
        result: 'NO_REPLY',
      });

    const tools = createNanoClawTools(
      {
        sendMessage: async () => undefined,
        schedulerDeps: {
          agents: async () => ({
            helper: {
              id: 'helper',
              folder: 'helper',
              name: 'Helper',
              trigger: '@helper',
              added_at: '2026-03-13T00:00:00.000Z',
            },
          }),
          getSessions: async () => ({}),
          runAgent,
          sendMessage: async () => undefined,
        },
      },
      {
        chatJid: 'discord:guild:thread',
        agentId: 'main',
        isMain: true,
      },
    );

    const emptyResult = await (tools.delegate_to_agent as any).execute({
      agent_id: 'helper',
      prompt: 'Do work',
    });
    const noReplyResult = await (tools.delegate_to_agent as any).execute({
      agent_id: 'helper',
      prompt: 'Do work again',
    });

    expect(emptyResult).toMatchObject({
      ok: true,
      agentId: 'helper',
      result: '',
    });
    expect(emptyResult.message).toContain('did not return any text result');
    expect(noReplyResult).toMatchObject({
      ok: true,
      agentId: 'helper',
      result: '',
    });
    expect(noReplyResult.message).toContain('did not return any text result');
  });

  it('surfaces delegated agent failures', async () => {
    const tools = createNanoClawTools(
      {
        sendMessage: async () => undefined,
        schedulerDeps: {
          agents: async () => ({
            helper: {
              id: 'helper',
              folder: 'helper',
              name: 'Helper',
              trigger: '@helper',
              added_at: '2026-03-13T00:00:00.000Z',
            },
          }),
          getSessions: async () => ({}),
          runAgent: vi.fn(async () => ({
            status: 'error' as const,
            result: null,
            error: 'boom',
          })),
          sendMessage: async () => undefined,
        },
      },
      {
        chatJid: 'discord:guild:thread',
        agentId: 'main',
        isMain: true,
      },
    );

    const result = await (tools.delegate_to_agent as any).execute({
      agent_id: 'helper',
      prompt: 'Do work',
    });

    expect(result).toMatchObject({
      ok: false,
      agentId: 'helper',
      error: 'boom',
    });
    expect(result.message).toContain('failed in agent helper');
  });
});
