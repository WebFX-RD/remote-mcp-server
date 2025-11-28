import { Request, Response, NextFunction } from 'express';
import type { ApiKeyUser } from './types.js';

interface ApiKeyUserResponse {
  firstName: string;
  lastName: string;
  email: string;
  type: string;
}

async function verifyApiKey(_apiKey: string): Promise<ApiKeyUserResponse> {
  // TODO: call POST authentication { strategy: 'apikey', apikey: _apiKey }
  throw new Error('Not implemented');
}

export async function apiKeyAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || Array.isArray(apiKey)) {
    next('route'); // No API key, skip to OAuth route
    return;
  }

  try {
    const { firstName, lastName, email, type } = await verifyApiKey(apiKey);
    const user: ApiKeyUser = {
      strategy: 'apikey',
      firstName,
      lastName,
      email,
      type,
    };
    req.user = user;
    next(); // Valid API key, continue to handler
  } catch {
    res.status(401).json({ error: 'Invalid API key' });
  }
}
