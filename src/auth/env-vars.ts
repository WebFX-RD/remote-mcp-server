function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const GOOGLE_CLIENT_ID = requireEnv('GOOGLE_CLIENT_ID');
export const GOOGLE_CLIENT_SECRET = requireEnv('GOOGLE_CLIENT_SECRET');
