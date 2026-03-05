import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const INSTANCE_FILE = path.join(DATA_DIR, 'instance.json');

export interface InstanceInfo {
  id: string;
  name: string;
  createdAt: string;
}

let cachedInstance: InstanceInfo | null = null;

function generateInstanceId(): string {
  return randomUUID();
}

function loadOrCreateInstance(): InstanceInfo {
  // Check if we have a cached instance
  if (cachedInstance) {
    return cachedInstance;
  }

  // Try to load from file
  if (fs.existsSync(INSTANCE_FILE)) {
    try {
      const data = JSON.parse(
        fs.readFileSync(INSTANCE_FILE, 'utf-8'),
      ) as InstanceInfo;
      cachedInstance = data;
      return data;
    } catch (err) {
      // Failed to load, will create new one
      console.warn('Failed to load instance file, creating new one:', err);
    }
  }

  // Get name from environment or generate a default
  const envName = process.env.NANOCLAW_INSTANCE_NAME;
  const instanceName = envName || `nanoclaw-${randomUUID().slice(0, 8)}`;

  // Create new instance
  const instance: InstanceInfo = {
    id: generateInstanceId(),
    name: instanceName,
    createdAt: new Date().toISOString(),
  };

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Save to file
  fs.writeFileSync(INSTANCE_FILE, JSON.stringify(instance, null, 2));
  cachedInstance = instance;

  console.log(
    `Created new NanoClaw instance: ${instance.name} (${instance.id})`,
  );

  return instance;
}

export function getInstanceInfo(): InstanceInfo {
  return loadOrCreateInstance();
}

export function getInstanceId(): string {
  return getInstanceInfo().id;
}

export function getInstanceName(): string {
  return getInstanceInfo().name;
}

export function updateInstanceName(name: string): void {
  const instance = loadOrCreateInstance();
  instance.name = name;
  fs.writeFileSync(INSTANCE_FILE, JSON.stringify(instance, null, 2));
  cachedInstance = instance;
  console.log(`Updated instance name to: ${name}`);
}
