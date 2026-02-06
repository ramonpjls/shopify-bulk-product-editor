/**
 * GraphQL Retry Utility with Rate Limit Handling
 * 
 * Provides robust retry logic with exponential backoff for Shopify GraphQL API calls.
 * Handles throttling errors and monitors rate limit status.
 */

export type AdminApiClient = {
  graphql(
    query: string,
    options?: {
      variables?: Record<string, unknown>;
    }
  ): Promise<Response>;
};

export type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: {
      code?: string;
    };
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
};

export type RetryOptions = {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, delay: number, reason: string) => void;
  onThrottled?: (available: number, maximum: number) => void;
};

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  onRetry: (attempt, delay, reason) => {
    console.warn(`GraphQL retry attempt ${attempt} after ${delay}ms: ${reason}`);
  },
  onThrottled: (available, maximum) => {
    console.warn(`Rate limit low: ${available}/${maximum} points available`);
  },
};

/**
 * Execute a GraphQL query with automatic retry logic and rate limit handling
 */
export async function graphqlWithRetry<T>(
  admin: AdminApiClient,
  query: string,
  options?: {
    variables?: Record<string, unknown>;
    retryOptions?: RetryOptions;
  }
): Promise<GraphQLResponse<T>> {
  const retryConfig = { ...DEFAULT_OPTIONS, ...options?.retryOptions };
  let attempt = 0;

  while (attempt <= retryConfig.maxRetries) {
    try {
      const response = await admin.graphql(query, {
        variables: options?.variables,
      });

      const json = (await response.json()) as GraphQLResponse<T>;

      // Check for throttling error
      const hasThrottleError = json.errors?.some(
        (error) => error.extensions?.code === "THROTTLED"
      );

      if (hasThrottleError && attempt < retryConfig.maxRetries) {
        attempt++;
        const delay = calculateBackoffDelay(
          attempt,
          retryConfig.initialDelay,
          retryConfig.maxDelay
        );
        retryConfig.onRetry(attempt, delay, "Throttled");
        await sleep(delay);
        continue;
      }

      // Monitor rate limit status
      if (json.extensions?.cost?.throttleStatus) {
        const { currentlyAvailable, maximumAvailable } =
          json.extensions.cost.throttleStatus;

        // Warn if running low on rate limit budget
        if (currentlyAvailable < maximumAvailable * 0.2) {
          retryConfig.onThrottled(currentlyAvailable, maximumAvailable);
        }

        // Proactive throttling: if very low, add small delay
        if (currentlyAvailable < 100) {
          const waitTime = 2000; // Wait 2 seconds to restore ~100 points
          console.log(
            `Rate limit very low (${currentlyAvailable}). Waiting ${waitTime}ms...`
          );
          await sleep(waitTime);
        }
      }

      return json;
    } catch (error) {
      // Network or other errors
      if (attempt >= retryConfig.maxRetries) {
        throw error;
      }

      attempt++;
      const delay = calculateBackoffDelay(
        attempt,
        retryConfig.initialDelay,
        retryConfig.maxDelay
      );
      const reason = error instanceof Error ? error.message : "Unknown error";
      retryConfig.onRetry(attempt, delay, reason);
      await sleep(delay);
    }
  }

  throw new Error("Max retries exceeded");
}

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number
): number {
  const exponentialDelay = initialDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // Add up to 30% jitter
  const delay = Math.min(exponentialDelay + jitter, maxDelay);
  return Math.floor(delay);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate Limit Monitor for tracking usage across multiple requests
 */
export class RateLimitMonitor {
  private currentlyAvailable: number;
  private maximumAvailable: number;
  private restoreRate: number;
  private lastUpdate: number;

  constructor(initialMaximum = 1000, initialRestore = 50) {
    this.currentlyAvailable = initialMaximum;
    this.maximumAvailable = initialMaximum;
    this.restoreRate = initialRestore;
    this.lastUpdate = Date.now();
  }

  /**
   * Update monitor state from GraphQL response
   */
  update(cost?: GraphQLResponse<unknown>["extensions"]["cost"]): void {
    if (!cost?.throttleStatus) return;

    this.currentlyAvailable = cost.throttleStatus.currentlyAvailable;
    this.maximumAvailable = cost.throttleStatus.maximumAvailable;
    this.restoreRate = cost.throttleStatus.restoreRate;
    this.lastUpdate = Date.now();
  }

  /**
   * Estimate current available points based on time elapsed
   */
  estimateAvailable(): number {
    const elapsed = Date.now() - this.lastUpdate;
    const restored = (elapsed / 1000) * this.restoreRate;
    return Math.min(
      this.currentlyAvailable + restored,
      this.maximumAvailable
    );
  }

  /**
   * Check if we should wait before making next request
   */
  shouldWait(requiredPoints = 100): boolean {
    return this.estimateAvailable() < requiredPoints;
  }

  /**
   * Wait until sufficient points are available
   */
  async waitForAvailability(requiredPoints = 100): Promise<void> {
    const available = this.estimateAvailable();
    if (available >= requiredPoints) return;

    const needed = requiredPoints - available;
    const waitTime = Math.ceil((needed / this.restoreRate) * 1000);

    console.log(
      `Waiting ${waitTime}ms for ${needed} rate limit points to restore...`
    );
    await sleep(waitTime);
  }

  /**
   * Get current status summary
   */
  getStatus(): {
    available: number;
    maximum: number;
    percentage: number;
    restoreRate: number;
  } {
    const available = this.estimateAvailable();
    return {
      available,
      maximum: this.maximumAvailable,
      percentage: (available / this.maximumAvailable) * 100,
      restoreRate: this.restoreRate,
    };
  }
}

/**
 * Batch executor with automatic rate limit handling
 */
export async function executeBatch<T, R>(
  admin: AdminApiClient,
  items: T[],
  queryBuilder: (item: T) => { query: string; variables?: Record<string, unknown> },
  options?: {
    batchSize?: number;
    delayBetweenBatches?: number;
    monitor?: RateLimitMonitor;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<R[]> {
  const batchSize = options?.batchSize ?? 10;
  const delay = options?.delayBetweenBatches ?? 500;
  const monitor = options?.monitor ?? new RateLimitMonitor();
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    // Wait if rate limit is low
    if (monitor.shouldWait(200)) {
      await monitor.waitForAvailability(200);
    }

    // Execute batch
    const batchPromises = batch.map(async (item) => {
      const { query, variables } = queryBuilder(item);
      const response = await graphqlWithRetry<R>(admin, query, { variables });
      monitor.update(response.extensions?.cost);
      return response.data;
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...(batchResults.filter(Boolean) as R[]));

    // Progress callback
    if (options?.onProgress) {
      options.onProgress(Math.min(i + batchSize, items.length), items.length);
    }

    // Delay between batches (except last one)
    if (i + batchSize < items.length) {
      await sleep(delay);
    }
  }

  return results;
}
