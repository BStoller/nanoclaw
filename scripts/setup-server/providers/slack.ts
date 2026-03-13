import crypto from 'node:crypto';
import { updateEnvFile } from '../env.js';
import { setupLogger } from '../logger.js';
import type { EnvState, SlackOauthResult } from '../types.js';

const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:read',
  'chat:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'mpim:history',
  'mpim:read',
  'reactions:read',
  'reactions:write',
  'users:read',
] as const;

interface SlackSetupOptions {
  env: EnvState;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface CallbackSuccess {
  statusCode: number;
  title: string;
  body: string;
}

export class SlackSetupFlow {
  readonly callbackPath = '/setup/slack/callback';

  readonly authorizeUrl: string;

  private readonly logger = setupLogger.child({ provider: 'slack' });

  private readonly state = crypto.randomBytes(24).toString('hex');

  private completionResolve!: () => void;

  private completionReject!: (error: unknown) => void;

  readonly completion = new Promise<void>((resolve, reject) => {
    this.completionResolve = resolve;
    this.completionReject = reject;
  });

  constructor(private readonly options: SlackSetupOptions) {
    const query = new URLSearchParams({
      client_id: options.clientId,
      scope: SLACK_BOT_SCOPES.join(','),
      redirect_uri: options.redirectUri,
      state: this.state,
    });

    this.authorizeUrl = `https://slack.com/oauth/v2/authorize?${query.toString()}`;
  }

  async handleCallback(url: URL): Promise<CallbackSuccess> {
    const error = url.searchParams.get('error');
    if (error) {
      this.logger.error({ error }, 'Slack OAuth returned an error');
      const failure = new Error(`Slack OAuth failed: ${error}`);
      this.completionReject(failure);
      return {
        statusCode: 400,
        title: 'Slack setup failed',
        body: `<h1>Slack setup failed</h1><p>${escapeHtml(error)}</p>`,
      };
    }

    const state = url.searchParams.get('state');
    if (!state || state !== this.state) {
      this.logger.error(
        { receivedState: state },
        'Slack OAuth state validation failed',
      );
      const failure = new Error('Slack OAuth state validation failed');
      this.completionReject(failure);
      return {
        statusCode: 400,
        title: 'Slack setup failed',
        body: '<h1>Slack setup failed</h1><p>State validation failed.</p>',
      };
    }

    const code = url.searchParams.get('code');
    if (!code) {
      const failure = new Error('Slack OAuth callback did not include a code');
      this.completionReject(failure);
      return {
        statusCode: 400,
        title: 'Slack setup failed',
        body: '<h1>Slack setup failed</h1><p>Missing authorization code.</p>',
      };
    }

    this.logger.info('Slack OAuth callback received');

    try {
      const oauthResult = await exchangeSlackCode({
        clientId: this.options.clientId,
        clientSecret: this.options.clientSecret,
        code,
        redirectUri: this.options.redirectUri,
        logger: this.logger,
      });

      const authTest = await verifySlackToken(
        oauthResult.botToken,
        this.logger,
      );

      await updateEnvFile(this.options.env, {
        SLACK_BOT_TOKEN: oauthResult.botToken,
        SLACK_TEAM_ID: oauthResult.teamId ?? authTest.teamId,
        SLACK_TEAM_NAME: oauthResult.teamName ?? authTest.team,
        SLACK_BOT_USER_ID: oauthResult.botUserId ?? authTest.userId,
      });

      this.logger.info(
        {
          teamId: oauthResult.teamId ?? authTest.teamId,
          teamName: oauthResult.teamName ?? authTest.team,
          botUserId: oauthResult.botUserId ?? authTest.userId,
        },
        'Stored Slack OAuth credentials',
      );

      this.completionResolve();

      return {
        statusCode: 200,
        title: 'Slack setup complete',
        body: '<h1>Slack setup complete</h1><p>You can return to the terminal. NanoClaw will finish setup automatically.</p>',
      };
    } catch (oauthError) {
      this.logger.error({ err: oauthError }, 'Slack OAuth exchange failed');
      this.completionReject(oauthError);
      return {
        statusCode: 500,
        title: 'Slack setup failed',
        body: '<h1>Slack setup failed</h1><p>Check the terminal and NanoClaw logs for details.</p>',
      };
    }
  }

  fail(error: unknown): void {
    this.completionReject(error);
  }
}

async function exchangeSlackCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  logger: typeof setupLogger;
}): Promise<SlackOauthResult> {
  input.logger.info('Exchanging Slack OAuth code for bot token');

  const response = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Slack oauth.v2.access failed with status ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    team?: { id?: string; name?: string };
    bot_user_id?: string;
    scope?: string;
    app_id?: string;
  };

  if (!payload.ok || !payload.access_token) {
    throw new Error(
      `Slack oauth.v2.access error: ${payload.error ?? 'missing access token'}`,
    );
  }

  input.logger.info(
    {
      teamId: payload.team?.id,
      teamName: payload.team?.name,
      botUserId: payload.bot_user_id,
      scope: payload.scope,
      appId: payload.app_id,
    },
    'Slack OAuth token exchange succeeded',
  );

  return {
    botToken: payload.access_token,
    teamId: payload.team?.id,
    teamName: payload.team?.name,
    botUserId: payload.bot_user_id,
    scope: payload.scope,
    appId: payload.app_id,
  };
}

async function verifySlackToken(
  botToken: string,
  logger: typeof setupLogger,
): Promise<{
  ok: true;
  team?: string;
  teamId?: string;
  userId?: string;
}> {
  logger.info('Verifying Slack bot token with auth.test');

  const response = await fetch('https://slack.com/api/auth.test', {
    headers: {
      authorization: `Bearer ${botToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Slack auth.test failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    error?: string;
    team?: string;
    team_id?: string;
    user_id?: string;
  };

  if (!payload.ok) {
    throw new Error(
      `Slack auth.test error: ${payload.error ?? 'unknown error'}`,
    );
  }

  logger.info(
    {
      team: payload.team,
      teamId: payload.team_id,
      userId: payload.user_id,
    },
    'Slack bot token verified',
  );

  return {
    ok: true,
    team: payload.team,
    teamId: payload.team_id,
    userId: payload.user_id,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
