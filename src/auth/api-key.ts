import { axios, axiosRetry, axiosEnhanceError } from '@webfx-rd/cloud-utils/axios';

export interface ApiKeyUserResponse {
  firstName: string;
  lastName: string;
  email: string;
  type: string;
}

const client = axios.create({ baseURL: 'https://api.webfx.com' });
axiosRetry(client);
axiosEnhanceError(client);

export async function verifyApiKey(apiKey: string): Promise<ApiKeyUserResponse> {
  const { data } = await client.post('iam/authentication', {
    strategy: 'apikey',
    apikey: apiKey,
  });

  let email: string | undefined;
  if (Array.isArray(data.user?.emails)) {
    for (const item of data.user.emails) {
      if (typeof item?.email === 'string' && item.email.endsWith('@webfx.com')) {
        email = item.email;
        break;
      }
    }
  }
  if (!email) {
    throw new Error('Failed to find email for user');
  }

  return {
    email,
    firstName: data.user.firstName,
    lastName: data.user.lastName,
    type: data.user.type,
  };
}
