/**
 * FMP API Client Utility
 *
 * This file provides a resilient client wrapper for the Financial Modeling Prep (FMP) API.
 * It includes an in-memory caching mechanism with automated cleanup, error handling logic
 * specifically designed for FMP rate limits and subscription constraints (handling 402, 403, 429),
 * and fallback mechanisms to generate or decompose historical candle data when the primary
 * 1-minute chart API fails.
 */

/**
 * Represents a cached entry in the memory cache.
 * @template T - The type of the cached value.
 */
interface CacheEntry<T> {
  /** The value being cached. */
  value: T;
  /** The Unix timestamp (in milliseconds) when the cache entry expires. */
  expiry: number;
}

/**
 * A client wrapper for making requests to the FMP API.
 * Includes built-in caching, error parsing, and fallback tracking.
 */
export class FmpApiClient {
  /** The API key used for FMP authentication. */
  private apiKey: string;
  /** The internal map storing cached API responses and their expiry timestamps. */
  private memoryCache = new Map<string, CacheEntry<any>>();
  /** The interval ID for the cache cleanup mechanism. Used to clear the interval on destruction to prevent memory leaks. */
  private cleanupIntervalId?: NodeJS.Timeout;
  /** Internal flag tracking whether the user's FMP subscription supports 1-minute historical charts. */
  private _is1MinUnsupported = false;

  /**
   * Initializes a new instance of the FmpApiClient and starts the cache cleanup interval.
   * @param apiKey - The API key used to authenticate requests to FMP.
   */
  constructor(apiKey: string) {
    this.apiKey = apiKey;

    // Prune expired cache entries every 5 minutes
    this.cleanupIntervalId = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.memoryCache.entries()) {
        if (now >= entry.expiry) {
          this.memoryCache.delete(key);
        }
      }
    }, 5 * 60 * 1000);
    if (this.cleanupIntervalId && typeof this.cleanupIntervalId.unref === 'function') {
      this.cleanupIntervalId.unref();
    }
  }

  /**
   * Cleans up resource allocations, including clearing the cache pruning interval
   * and emptying the memory cache to prevent memory leaks.
   * @returns void
   */
  public destroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
    this.memoryCache.clear();
  }

  /**
   * Gets whether 1-minute historical charts are explicitly unsupported by the current FMP plan.
   * @returns True if 1-minute charts are unsupported, false otherwise.
   */
  public get is1MinUnsupported(): boolean {
    return this._is1MinUnsupported;
  }

  /**
   * Sets whether 1-minute historical charts are explicitly unsupported by the current FMP plan.
   * @param value - The new unsupported status.
   */
  public set is1MinUnsupported(value: boolean) {
    this._is1MinUnsupported = value;
  }

  /**
   * Helper to perform GET request to FMP, handle status codes, and manage cache.
   * @template T - The expected return type of the JSON response.
   * @param url - The full URL endpoint to fetch.
   * @param ttlMs - Time-to-live for the cache in milliseconds.
   * @param options - Additional options for the request.
   * @param options.is1Min - Optional flag indicating if the request is for 1-minute historical charts.
   * @returns A promise that resolves to the parsed JSON response of type T.
   * @throws Will throw an error if the HTTP response is not ok.
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
   * Modular HTTP status code handler for standardizing FMP API warnings and fallback behavior.
   * @param status - The HTTP status code returned by the fetch request.
   * @param url - The URL that was fetched (API key will be masked in logs).
   * @param is1Min - Flag indicating if the failing request was specifically for a 1-minute chart.
   * @returns void
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


