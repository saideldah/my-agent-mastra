import { MastraClient } from '@mastra/client-js';

export const MASTRA_BASE_URL =
  import.meta.env.VITE_MASTRA_API_URL || 'http://localhost:4111';

export function createMastraClient(token: string, abortSignal?: AbortSignal) {
  return new MastraClient({
    baseUrl: MASTRA_BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
    abortSignal,
  });
}
