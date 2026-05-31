/**
 * Circuit Breaker pattern for resilient service calls at scale.
 *
 * Prevents cascade failures when downstream services (Discord bot,
 * Airtable, edge functions) become unavailable by short-circuiting
 * calls after repeated failures.
 *
 * States:
 * - CLOSED:    Normal operation, requests pass through.
 * - OPEN:      Too many failures, requests fail immediately.
 * - HALF_OPEN: After cooldown, one probe request is allowed.
 */

import { createLogger } from "@/services/logger.service";
import { reportRecovery } from "@/services/error-reporter.service";

const log = createLogger("CircuitBreaker");

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitBreakerOptions {
  /** Name for logging */
  name: string;
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms before attempting a probe after opening (default: 30 000) */
  cooldownMs?: number;
  /** Time in ms before resetting the failure count (default: 60 000) */
  windowMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime = 0;
  private openedAt = 0;
  private recoveryAttempts = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly windowMs: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.windowMs = options.windowMs ?? 60_000;
  }

  /** Execute a function through the circuit breaker */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.state = "HALF_OPEN";
        log.info("execute", `Circuit "${this.name}" entering HALF_OPEN — allowing probe request`);
      } else {
        log.warn("execute", `Circuit "${this.name}" is OPEN — fast-failing request`, {
          failureCount: this.failureCount,
          cooldownRemainingMs: this.cooldownMs - (Date.now() - this.openedAt),
        });
        throw new Error(`Service "${this.name}" is temporarily unavailable. Please try again shortly.`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /**
   * Execute with a fallback value when the circuit is open.
   * Useful for non-critical features (e.g. Discord notifications).
   */
  async executeWithFallback<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await this.execute(fn);
    } catch {
      return fallback;
    }
  }

  private onSuccess() {
    if (this.state === "HALF_OPEN") {
      log.info("execute", `Circuit "${this.name}" probe succeeded — closing circuit`);
      // Wave 1 PERF-W1-010: static import keeps a single error-reporter
      // singleton and removes the Vite static/dynamic collision warning.
      try {
        reportRecovery(this.name, { attempts: this.recoveryAttempts || this.failureCount });
      } catch { /* never throw from telemetry */ }
    }
    this.state = "CLOSED";
    this.failureCount = 0;
    this.recoveryAttempts = 0;
  }

  private onFailure() {
    const now = Date.now();

    // Reset failure count if outside the rolling window
    if (now - this.lastFailureTime > this.windowMs) {
      this.failureCount = 0;
    }

    this.failureCount++;
    this.recoveryAttempts++;
    this.lastFailureTime = now;

    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = now;
      log.error("execute", `Circuit "${this.name}" OPENED after ${this.failureCount} failures`, {
        failureThreshold: this.failureThreshold,
        cooldownMs: this.cooldownMs,
      });
    } else if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = now;
      log.warn("execute", `Circuit "${this.name}" probe failed — re-opening`, {
        failureCount: this.failureCount,
      });
    }
  }

  /** Get current state (for testing/monitoring) */
  getState(): { state: CircuitState; failureCount: number } {
    return { state: this.state, failureCount: this.failureCount };
  }

  /** Force reset (for testing) */
  reset() {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.openedAt = 0;
  }
}

// ─── Pre-configured breakers for known services ──────────────────────

/** Discord API (bot, webhooks) — tolerate more failures, longer cooldown */
export const discordBreaker = new CircuitBreaker({
  name: "Discord",
  failureThreshold: 5,
  cooldownMs: 60_000,
  windowMs: 120_000,
});

/** Airtable sync — non-critical, open quickly */
export const airtableBreaker = new CircuitBreaker({
  name: "Airtable",
  failureThreshold: 3,
  cooldownMs: 45_000,
  windowMs: 60_000,
});

/** Generic edge function calls */
export const edgeFunctionBreaker = new CircuitBreaker({
  name: "EdgeFunction",
  failureThreshold: 8,
  cooldownMs: 30_000,
  windowMs: 60_000,
});

/** Firecrawl web search — non-critical, open quickly */
export const firecrawlBreaker = new CircuitBreaker({
  name: "Firecrawl",
  failureThreshold: 3,
  cooldownMs: 45_000,
  windowMs: 60_000,
});
