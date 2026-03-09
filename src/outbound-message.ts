const DISCORD_MAX_MESSAGE_LENGTH = 2000;

export function splitOutboundMessageForPlatform(
  platform: string,
  text: string,
): string[] {
  if (platform !== 'discord') {
    return [text];
  }

  return splitTextIntoChunks(text, DISCORD_MAX_MESSAGE_LENGTH);
}

export function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const splitAt = findSplitPoint(remaining, maxLength);
    const chunk = remaining.slice(0, splitAt).trimEnd();

    if (!chunk) {
      chunks.push(remaining.slice(0, maxLength));
      remaining = remaining.slice(maxLength);
      continue;
    }

    chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function findSplitPoint(text: string, maxLength: number): number {
  const separators = ['\n\n', '\n', ' '];

  for (const separator of separators) {
    const idx = text.lastIndexOf(separator, maxLength);
    if (idx >= Math.floor(maxLength / 2)) {
      return idx + separator.length;
    }
  }

  return maxLength;
}

export { DISCORD_MAX_MESSAGE_LENGTH };
