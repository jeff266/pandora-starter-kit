import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Serper');

export interface SerperSearchResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 200;

async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestTime = Date.now();
}

export async function searchCompanySignals(
  companyName: string,
  apiKey: string
): Promise<SerperSearchResult[]> {
  try {
    await throttle();

    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: `"${companyName}" news`, num: 10 }),
    });

    if (response.status === 429) {
      logger.warn('Rate limited by Serper API, backing off 30s', { companyName });
      await new Promise(resolve => setTimeout(resolve, 30000));

      const retryResponse = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: `"${companyName}" news`, num: 10 }),
      });

      if (!retryResponse.ok) {
        logger.error('Serper API retry failed', new Error(`Status ${retryResponse.status}`), { companyName });
        return [];
      }

      const retryData = await retryResponse.json() as any;
      return (retryData.organic || []).map((r: any) => ({
        title: r.title || '',
        link: r.link || '',
        snippet: r.snippet || '',
        date: r.date || undefined,
      }));
    }

    if (!response.ok) {
      logger.error('Serper API error', new Error(`Status ${response.status}`), { companyName });
      return [];
    }

    const data = await response.json() as any;
    return (data.organic || []).map((r: any) => ({
      title: r.title || '',
      link: r.link || '',
      snippet: r.snippet || '',
      date: r.date || undefined,
    }));
  } catch (err) {
    logger.error('Serper search failed', err instanceof Error ? err : new Error(String(err)), { companyName });
    return [];
  }
}
