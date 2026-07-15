interface CacheEntry<T> {
  value: T;
  expiry: number;
}

export class FmpApiClient {
  private apiKey: string;
  private memoryCache = new Map<string, CacheEntry<any>>();
  private _is1MinUnsupported = false;

  constructor(apiKey: string) {
    this.apiKey = apiKey;

    // Prune expired cache entries every 5 minutes
    const cacheCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.memoryCache.entries()) {
        if (now >= entry.expiry) {
          this.memoryCache.delete(key);
        }
      }
    }, 5 * 60 * 1000);
    if (cacheCleanupInterval && typeof cacheCleanupInterval.unref === 'function') {
      cacheCleanupInterval.unref();
    }
  }

  public get is1MinUnsupported(): boolean {
    return this._is1MinUnsupported;
  }

  public set is1MinUnsupported(value: boolean) {
    this._is1MinUnsupported = value;
  }

  /**
   * Helper to perform GET request to FMP, handle status codes, and manage cache.
   */
  public async fetchWithCache<T>(url: string, ttlMs: number, options: { is1Min?: boolean } = {}): Promise<T> {
    // 1. Check cache first
    const cached = this.memoryCache.get(url);
    if (cached && Date.now() < cached.expiry) {
      return cached.value;
    }

    // 2. Perform fetch
    const res = await fetch(url);
    if (!res.ok) {
      this.handleHttpError(res.status, url, options.is1Min || false);
      throw new Error(`FMP API error: status ${res.status}`);
    }

    // 3. Cache and return data
    const data = await res.json();
    if (ttlMs > 0) {
      this.memoryCache.set(url, {
        value: data,
        expiry: Date.now() + ttlMs
      });
    }
    return data;
  }

  /**
   * Modular HTTP status code handler.
   */
  private handleHttpError(status: number, url: string, is1Min: boolean): void {
    const sanitizedUrl = url.replace(/apikey=[^&]+/g, 'apikey=SECRET');
    if (status === 402) {
      if (is1Min) {
        this._is1MinUnsupported = true;
        console.warn(`[FMP 1MIN CHART DISABLING] 1-minute chart request is not supported by the FMP subscription (status 402). Bypassing further 1-min requests and using 5-min fallback.`);
      } else {
        console.warn(`[FMP API WARNING] Request to ${sanitizedUrl} failed with status 402: Request is not supported by the FMP subscription, or daily quota exceeded.`);
      }
    } else if (status === 403) {
      if (is1Min) {
        this._is1MinUnsupported = true;
        console.warn(`[FMP 1MIN CHART DISABLING] 1-minute chart request returned Forbidden (status 403) - likely due to an invalid or missing API key. Bypassing further 1-min requests and using 5-min fallback.`);
      } else {
        console.warn(`[FMP API WARNING] Request to ${sanitizedUrl} failed with status 403: Forbidden - invalid or missing API key.`);
      }
    } else if (status === 429) {
      if (is1Min) {
        // Fall back to 5-min chart decomposition to prevent continuous API spam
        console.warn(`[FMP API WARNING] Request to ${sanitizedUrl} failed with status 429: Too Many Requests - daily request limit has been exceeded. Falling back to 5-min chart.`);
      } else {
        console.warn(`[FMP API WARNING] Request to ${sanitizedUrl} failed with status 429: Too Many Requests - daily request limit has been exceeded for the FMP API key.`);
      }
    } else {
      console.warn(`[FMP API WARNING] Request to ${sanitizedUrl} failed with status ${status}.`);
    }
  }
}
