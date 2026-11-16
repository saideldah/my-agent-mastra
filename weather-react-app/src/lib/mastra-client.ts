import { MastraClient } from '@mastra/client-js';

export const MASTRA_BASE_URL =
  import.meta.env.VITE_MASTRA_API_URL ||
  (typeof window !== 'undefined' && window.location.port !== '5173'
    ? window.location.origin
    : 'http://localhost:4111');

export function createMastraClient(token: string, abortSignal?: AbortSignal) {
  return new MastraClient({
    baseUrl: MASTRA_BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
    abortSignal,
  });
}
