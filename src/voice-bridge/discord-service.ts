import {
  GuildMember,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';

import { logger } from '../logger.js';
import {
  DiscordGatewayVoiceTransport,
  DiscordVoiceAdapter,
  isDiscordVoiceJoinCommand,
  isDiscordVoiceLeaveCommand,
} from './adapters/discord.js';
import type { VoiceBridgeSessionManager } from './core/session-manager.js';

function getInteractionVoiceChannel(
  interaction: ChatInputCommandInteraction,
): { guildId: string; channelId: string; member: GuildMember } | null {
  if (!interaction.inGuild() || !interaction.guildId) {
    return null;
  }

  const member = interaction.member;
  if (!member || !(member instanceof GuildMember)) {
    return null;
  }

  const voiceChannel = member.voice.channel;
  if (!voiceChannel) {
    return null;
  }

  return {
    guildId: interaction.guildId,
    channelId: voiceChannel.id,
    member,
  };
}

function getMessageVoiceChannel(
  message: Message,
): { guildId: string; channelId: string; member: GuildMember } | null {
  if (
    !message.guildId ||
    !message.member ||
    !(message.member instanceof GuildMember)
  ) {
    return null;
  }

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel) {
    return null;
  }

  return {
    guildId: message.guildId,
    channelId: voiceChannel.id,
    member: message.member,
  };
}

async function startDiscordVoiceSession(input: {
  manager: VoiceBridgeSessionManager;
  guildId: string;
  voiceChannelId: string;
  summonChannelId?: string;
  startedBy: string;
  participants: Array<{ participantId: string; displayName: string }>;
}): Promise<{ alreadyActive: boolean }> {
  const platformSessionId = `${input.guildId}:${input.voiceChannelId}`;
  logger.info(
    {
      guildId: input.guildId,
      voiceChannelId: input.voiceChannelId,
      summonChannelId: input.summonChannelId,
      startedBy: input.startedBy,
      participantCount: input.participants.length,
    },
    'Received Discord voice session start request',
  );
  const existing = input.manager.findActiveSessionByPlatform(
    'discord',
    platformSessionId,
  );
  if (existing) {
    logger.warn(
      { guildId: input.guildId, voiceChannelId: input.voiceChannelId },
      'Discord voice session already active for channel',
    );
    return { alreadyActive: true };
  }

  const routeKey = `voice:discord:${input.guildId}:${input.voiceChannelId}`;
  const linkedTextThreadId = input.summonChannelId
    ? `discord:${input.guildId}:${input.summonChannelId}`
    : undefined;

  await input.manager.startSession({
    platform: 'discord',
    mode: 'join',
    targetId: platformSessionId,
    routeKey,
    startedBy: input.startedBy,
    participants: input.participants,
    link: linkedTextThreadId ? { textThreadId: linkedTextThreadId } : undefined,
    metadata: {
      summonChannelId: input.summonChannelId,
      guildId: input.guildId,
      voiceChannelId: input.voiceChannelId,
    },
  });

  return { alreadyActive: false };
}

async function stopDiscordVoiceSession(input: {
  manager: VoiceBridgeSessionManager;
  guildId: string;
  voiceChannelId?: string;
}): Promise<'not_found' | 'stopped'> {
  logger.info(
    {
      guildId: input.guildId,
      voiceChannelId: input.voiceChannelId,
    },
    'Received Discord voice session stop request',
  );
  const platformSessionId = input.voiceChannelId
    ? `${input.guildId}:${input.voiceChannelId}`
    : input.manager
        .listActiveSessions()
        .find(
          (session) =>
            session.platform === 'discord' &&
            session.platformSessionId.startsWith(`${input.guildId}:`),
        )?.platformSessionId;

  if (!platformSessionId) {
    logger.warn(
      { guildId: input.guildId, voiceChannelId: input.voiceChannelId },
      'No matching Discord voice session found to stop',
    );
    return 'not_found';
  }

  const existing = input.manager.findActiveSessionByPlatform(
    'discord',
    platformSessionId,
  );
  if (!existing) {
    logger.warn(
      { guildId: input.guildId, platformSessionId },
      'Discord voice session lookup failed during stop',
    );
    return 'not_found';
  }

  await input.manager.stopSession(existing.voiceSessionId);
  return 'stopped';
}

export async function createDiscordVoiceIntegration(
  manager: VoiceBridgeSessionManager,
): Promise<DiscordVoiceAdapter | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    logger.info(
      'Discord voice integration disabled because DISCORD_BOT_TOKEN is missing',
    );
    return null;
  }

  const transport = new DiscordGatewayVoiceTransport(
    token,
    process.env.DISCORD_VOICE_COMMAND_GUILD_ID,
  );
  const adapter = new DiscordVoiceAdapter(transport);
  logger.info('Creating Discord voice integration');

  transport.getClient().on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    logger.debug(
      {
        commandName: interaction.commandName,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        userId: interaction.user.id,
      },
      'Received Discord interaction for voice service',
    );

    if (isDiscordVoiceJoinCommand(interaction)) {
      const voiceState = getInteractionVoiceChannel(interaction);
      if (!voiceState) {
        logger.warn(
          { guildId: interaction.guildId, userId: interaction.user.id },
          'Discord join command issued without user in a voice channel',
        );
        await interaction.reply({
          content: 'Join a voice channel first, then run `/voice-join`.',
          ephemeral: true,
        });
        return;
      }

      const participants = Array.from(
        voiceState.member.voice.channel!.members.values(),
      ).map((member) => ({
        participantId: member.id,
        displayName: member.displayName,
      }));

      try {
        const result = await startDiscordVoiceSession({
          manager,
          guildId: voiceState.guildId,
          voiceChannelId: voiceState.channelId,
          summonChannelId: interaction.channelId,
          startedBy: interaction.user.id,
          participants,
        });

        if (result.alreadyActive) {
          await interaction.reply({
            content: `NanoClaw is already active in <#${voiceState.channelId}>.`,
            ephemeral: true,
          });
          return;
        }

        await interaction.reply({
          content: `Joining <#${voiceState.channelId}> and starting a realtime voice session.`,
          ephemeral: true,
        });
      } catch (err) {
        logger.error({ err }, 'Failed to start Discord voice session');
        await interaction.reply({
          content: `Failed to join voice: ${err instanceof Error ? err.message : String(err)}`,
          ephemeral: true,
        });
      }
      return;
    }

    if (isDiscordVoiceLeaveCommand(interaction)) {
      logger.debug(
        {
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          userId: interaction.user.id,
        },
        'Processing Discord voice leave command',
      );
      const voiceState = getInteractionVoiceChannel(interaction);
      const result = interaction.guildId
        ? await stopDiscordVoiceSession({
            manager,
            guildId: interaction.guildId,
            voiceChannelId: voiceState?.channelId,
          })
        : 'not_found';

      if (result === 'not_found') {
        await interaction.reply({
          content: 'No active NanoClaw voice session found in this guild.',
          ephemeral: true,
        });
        return;
      }
      await interaction.reply({
        content: 'Leaving the active NanoClaw voice session.',
        ephemeral: true,
      });
    }
  });

  transport.getClient().on('messageCreate', async (message) => {
    if (message.author.bot || !message.guildId) {
      return;
    }

    const content = message.content.trim().toLowerCase();
    if (content !== '!voice-join' && content !== '!voice-leave') {
      return;
    }

    logger.debug(
      {
        guildId: message.guildId,
        channelId: message.channelId,
        authorId: message.author.id,
        command: content,
      },
      'Received Discord text voice command',
    );

    if (content === '!voice-join') {
      const voiceState = getMessageVoiceChannel(message);
      if (!voiceState) {
        logger.warn(
          { guildId: message.guildId, authorId: message.author.id },
          'Discord text join command issued without user in a voice channel',
        );
        await message.reply(
          'Join a voice channel first, then send `!voice-join`.',
        );
        return;
      }

      const participants = Array.from(
        voiceState.member.voice.channel!.members.values(),
      ).map((member) => ({
        participantId: member.id,
        displayName: member.displayName,
      }));

      try {
        const result = await startDiscordVoiceSession({
          manager,
          guildId: voiceState.guildId,
          voiceChannelId: voiceState.channelId,
          summonChannelId: message.channelId,
          startedBy: message.author.id,
          participants,
        });

        await message.reply(
          result.alreadyActive
            ? `NanoClaw is already active in <#${voiceState.channelId}>.`
            : `Joining <#${voiceState.channelId}> and starting a realtime voice session.`,
        );
      } catch (err) {
        logger.error(
          { err },
          'Failed to start Discord voice session from message',
        );
        await message.reply(
          `Failed to join voice: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }

    const result = await stopDiscordVoiceSession({
      manager,
      guildId: message.guildId,
      voiceChannelId: getMessageVoiceChannel(message)?.channelId,
    });

    await message.reply(
      result === 'stopped'
        ? 'Leaving the active NanoClaw voice session.'
        : 'No active NanoClaw voice session found in this guild.',
    );
  });

  logger.info('Discord voice integration ready');
  return adapter;
}
