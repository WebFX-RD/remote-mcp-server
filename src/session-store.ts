import { randomUUID } from 'node:crypto';
import { getRedisClient } from '@webfx-rd/cloud-utils/redis';

const ONE_DAY_SECONDS = 86_400;

export async function createSession(email: string): Promise<string> {
  const sessionId = randomUUID();
  const redis = getRedisClient();
  await redis.set(`mcp:sessions:${sessionId}`, email, 'EX', ONE_DAY_SECONDS);
  return sessionId;
}

export async function validateSession(sessionId: string, email: string) {
  const redis = getRedisClient();
  const storedEmail = await redis.get(`mcp:sessions:${sessionId}`);
  if (!storedEmail) {
    return 'Failed to find sessionId';
  }
  if (storedEmail !== email) {
    return `Expected email ${storedEmail}, received ${email}`;
  }
}

export async function get<T>(sessionId: string, key: string): Promise<T | undefined> {
  if (typeof sessionId !== 'string') {
    throw new Error(`Expected sessionId to be a string, received ${sessionId}`);
  }
  if (typeof key !== 'string') {
    throw new Error(`Expected key to be a string, received ${key}`);
  }

  const redis = getRedisClient();
  const value = await redis.get(`mcp:${sessionId}:${key}`);
  if (!value) {
    return;
  }

  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    return JSON.parse(value) as T;
  }

  return value as T;
}

export async function set(sessionId: string, key: string, value: unknown) {
  if (typeof sessionId !== 'string') {
    throw new Error(`Expected sessionId to be a string, received ${sessionId}`);
  }
  if (typeof key !== 'string') {
    throw new Error(`Expected key to be a string, received ${key}`);
  }

  const redis = getRedisClient();

  let valuePrep: string;
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
    valuePrep = JSON.stringify(value);
  } else {
    valuePrep = `${value}`;
  }

  await redis.set(`mcp:${sessionId}:${key}`, valuePrep, 'EX', ONE_DAY_SECONDS);
}
