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
