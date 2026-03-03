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
  url.searchParams.set('token', this.API_TOKEN);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      console.error(`API request failed with status ${res.status}`);
      return (await res.json()) as TerrorApiResponseFailure;
      
    } else {
      return (await res.json()) as TerrorApiResponseSuccess;
    }
    
  } finally {
    clearTimeout(timeout);
  }
}
}