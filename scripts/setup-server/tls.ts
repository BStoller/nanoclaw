import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { setupLogger } from './logger.js';
import type { TlsCertificatePaths } from './types.js';

const METADATA_BASE_URL = 'http://169.254.169.254/latest';
const CERTBOT_ROOT = '/opt/nanoclaw-certbot';
const CERTBOT_BIN = `${CERTBOT_ROOT}/bin/certbot`;
const CERTBOT_MIN_VERSION = [5, 4, 0] as const;

export async function discoverPublicIpv4(): Promise<string> {
  const tokenResponse = await fetch(`${METADATA_BASE_URL}/api/token`, {
    method: 'PUT',
    headers: {
      'X-aws-ec2-metadata-token-ttl-seconds': '300',
    },
  });

  if (!tokenResponse.ok) {
    throw new Error(
      `Failed to retrieve EC2 metadata token (${tokenResponse.status})`,
    );
  }

  const token = await tokenResponse.text();
  const ipResponse = await fetch(`${METADATA_BASE_URL}/meta-data/public-ipv4`, {
    headers: {
      'X-aws-ec2-metadata-token': token,
    },
  });

  if (!ipResponse.ok) {
    throw new Error(
      `Failed to retrieve EC2 public IPv4 (${ipResponse.status})`,
    );
  }

  const publicIp = (await ipResponse.text()).trim();
  if (!publicIp) {
    throw new Error('EC2 public IPv4 metadata response was empty');
  }

  setupLogger.info({ publicIp }, 'Detected EC2 public IPv4');
  return publicIp;
}

export async function ensureIpCertificate(
  publicIp: string,
): Promise<TlsCertificatePaths> {
  const tlsLogger = setupLogger.child({ component: 'tls', publicIp });
  const certbot = await ensureCertbotBinary(tlsLogger);

  tlsLogger.info("Requesting Let's Encrypt IP certificate");

  await runCommand(
    certbot,
    [
      'certonly',
      '--non-interactive',
      '--agree-tos',
      '--register-unsafely-without-email',
      '--preferred-profile',
      'shortlived',
      '--keep-until-expiring',
      '--standalone',
      '--cert-name',
      publicIp,
      '--ip-address',
      publicIp,
    ],
    tlsLogger,
  );

  const certPath = `/etc/letsencrypt/live/${publicIp}/fullchain.pem`;
  const keyPath = `/etc/letsencrypt/live/${publicIp}/privkey.pem`;

  await fs.access(certPath);
  await fs.access(keyPath);

  tlsLogger.info({ certPath, keyPath }, "Let's Encrypt IP certificate ready");
  return { certPath, keyPath };
}

async function ensureCertbotBinary(
  logger: typeof setupLogger,
): Promise<string> {
  let needsInstall = false;

  try {
    const { stdout } = await runCommand(
      CERTBOT_BIN,
      ['--version'],
      logger,
      true,
    );
    const version = extractVersion(stdout);
    if (!version || compareVersions(version, CERTBOT_MIN_VERSION) < 0) {
      needsInstall = true;
    }
  } catch {
    needsInstall = true;
  }

  if (!needsInstall) {
    return CERTBOT_BIN;
  }

  logger.info('Installing Certbot with IP certificate support');
  await runCommand('python3', ['-m', 'venv', CERTBOT_ROOT], logger);
  await runCommand(
    `${CERTBOT_ROOT}/bin/pip`,
    ['install', '--upgrade', 'pip'],
    logger,
  );
  await runCommand(
    `${CERTBOT_ROOT}/bin/pip`,
    ['install', '--upgrade', 'certbot>=5.4.0'],
    logger,
  );

  const { stdout } = await runCommand(CERTBOT_BIN, ['--version'], logger, true);
  const version = extractVersion(stdout);
  if (!version || compareVersions(version, CERTBOT_MIN_VERSION) < 0) {
    throw new Error(
      `Installed Certbot is too old for IP certificates: ${stdout.trim()}`,
    );
  }

  logger.info({ version: version.join('.') }, 'Certbot installation complete');
  return CERTBOT_BIN;
}

function extractVersion(output: string): number[] | null {
  const match = output.match(/certbot\s+(\d+)\.(\d+)\.(\d+)/i);
  if (!match) {
    return null;
  }

  return match.slice(1).map((value) => Number.parseInt(value, 10));
}

function compareVersions(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

async function runCommand(
  command: string,
  args: string[],
  logger: typeof setupLogger,
  captureOutput = false,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'pipe',
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (!captureOutput) {
        process.stdout.write(text);
      }
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (!captureOutput) {
        process.stderr.write(text);
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      logger.error(
        { command, args, code, stderr: stderr.trim() },
        'Command failed',
      );
      reject(
        new Error(`${command} ${args.join(' ')} exited with code ${code}`),
      );
    });
  });
}
