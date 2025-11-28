export interface OAuthUser {
  strategy: 'oauth';
  email: string;
  googleUserId: string;
  scopes: string[];
}

export interface ApiKeyUser {
  strategy: 'apikey';
  email: string;
  firstName: string;
  lastName: string;
  type: string;
}

export type AppUser = OAuthUser | ApiKeyUser;

declare global {
  namespace Express {
    interface Request {
      user?: AppUser;
    }
  }
}
