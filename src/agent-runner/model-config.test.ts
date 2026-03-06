import { describe, expect, it } from 'vitest';

import {
  getAvailableModels,
  getModelConfig,
  isModelConfigured,
} from './model-config.js';

describe('model-config', () => {
  it('exposes gpt-5.4 as an available model', () => {
    expect(
      getAvailableModels().find(
        (model) =>
          model.provider === 'opencode-zen' && model.modelName === 'gpt-5.4',
      ),
    ).toEqual({
      provider: 'opencode-zen',
      modelName: 'gpt-5.4',
      contextWindow: 400000,
      supportsVision: true,
    });
  });

  it('validates gpt-5.4 and preserves its response format config', () => {
    expect(isModelConfigured('opencode-zen', 'gpt-5.4')).toBe(true);
    expect(getModelConfig('opencode-zen', 'gpt-5.4')).toMatchObject({
      provider: 'opencode-zen',
      modelName: 'gpt-5.4',
      isOpenAIResponseFormat: true,
      contextWindow: 400000,
      supportsVision: true,
    });
  });
});
