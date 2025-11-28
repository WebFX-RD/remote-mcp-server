import { Request, Response, NextFunction } from 'express';
import { log } from '@webfx-rd/cloud-utils/log';
import { axios, axiosRetry, axiosEnhanceError } from '@webfx-rd/cloud-utils/axios';

import type { ApiKeyUser } from './types.js';

interface ApiKeyUserResponse {
  firstName: string;
  lastName: string;
  email: string;
  type: string;
}

const client = axios.create({ baseURL: 'https://api.webfx.com' });
axiosRetry(client);
axiosEnhanceError(client);

async function verifyApiKey(apiKey: string): Promise<ApiKeyUserResponse> {
  const res = await client.post('iam/authentication', {
    strategy: 'apikey',
    apikey: apiKey,
  });
  return {
    email: res.data.user.email,
    firstName: res.data.user.firstName,
    lastName: res.data.user.lastName,
    type: res.data.user.type,
  };
}

export async function apiKeyAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    next('route'); // No API key, skip to OAuth route
    return;
  }
  if (Array.isArray(apiKey)) {
    res.status(400).json({ error: 'Expected x-api-key to be a string, received string[]' });
    return;
  }
  try {
    const { firstName, lastName, email, type } = await verifyApiKey(apiKey);
    const user: ApiKeyUser = { strategy: 'apikey', firstName, lastName, email, type };
    req.user = user;
    next(); // Valid API key, continue to handler
  } catch (error: any) {
    log.error('Invalid API key:', error);
    res.status(401).json({ error: 'Invalid API key' });
  }
}
