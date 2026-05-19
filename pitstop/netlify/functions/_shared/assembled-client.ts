/**
 * Assembled API client — typed wrappers for REST + internal endpoints.
 * v0.1: stubs only. Credentials from env; never exposed to browser.
 */

import { env } from "./env.js";

export class AssembledClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor() {
    this.apiKey = env("ASSEMBLED_API_KEY");
    this.baseUrl = env("ASSEMBLED_BASE_URL", "https://api.assembledhq.com");
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /** Stub: update activity start time */
  async updateActivityStart(
    _activityId: string,
    _newStartIso: string,
  ): Promise<{ ok: boolean; mock: boolean }> {
    if (!this.isConfigured) {
      return { ok: true, mock: true };
    }
    // TODO: real PATCH /activities/:id
    return { ok: true, mock: false };
  }
}

let client: AssembledClient | null = null;

export function getAssembledClient(): AssembledClient {
  if (!client) client = new AssembledClient();
  return client;
}
