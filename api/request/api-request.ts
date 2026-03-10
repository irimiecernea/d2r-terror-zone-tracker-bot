import { TerrorApiResponseSuccess } from '../response/success-api-response.js';
import { TerrorApiResponseFailure } from '../response/failure-api-response.js';

export class APIRequest {

    readonly API_URL: string
    readonly API_TOKEN: string

    constructor(API_URL: string, API_TOKEN: string) {
        this.API_URL = API_URL;
        this.API_TOKEN = API_TOKEN;
    }

async fetchTerrorZone(): Promise<TerrorApiResponseSuccess | TerrorApiResponseFailure> {
  const url = new URL(this.API_URL);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json', authorization: `${this.API_TOKEN}` },
    });

    if (!res.ok) {
      console.error(`API request failed with status ${res.status}`);
      return (await res.json()) as TerrorApiResponseFailure;
      
    } else {
      console.log('API request successful');
      return (await res.json()) as TerrorApiResponseSuccess;
    }
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') {
      return { status: 'error', message: 'API request timed out after 5000ms.' };
    }

    return {
      status: 'error',
      message: `API request failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
}
