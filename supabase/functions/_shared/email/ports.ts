// Ports (interfaces) implemented by the infrastructure layer. Domain depends only on these.
import type {
  CircuitBreakerSnapshot, EmailEnvelope, Lane, PolicyConfig, ProviderOutcome,
} from './domain/types.ts';

export interface ClaimedRow {
  id: string; lane: Lane; template: string; recipient: string; subject?: string;
  payload: Record<string, unknown>; idempotencyKey: string; messageId: string;
  attempts: number; traceId?: string;
}

export interface OutboxRepo {
  enqueue(env: EmailEnvelope): Promise<string>;
  claimDue(max: number): Promise<ClaimedRow[]>;
  recordResult(id: string, outcome: ProviderOutcome): Promise<void>;
  gcExpired(): Promise<number>;
}

export interface SuppressionRepo {
  isSuppressed(recipient: string): Promise<boolean>;
}

export interface LaneStateRepo {
  snapshot(lane: Lane): Promise<CircuitBreakerSnapshot>;
}

export interface PolicyRepo {
  load(): Promise<PolicyConfig>;
}

export interface EmailProviderPort {
  send(env: EmailEnvelope): Promise<ProviderOutcome>;
}

export interface EventSink {
  emit(kind: string, payload: Record<string, unknown>, severity?: 'info'|'warn'|'error'): Promise<void>;
}

export interface Clock { now(): Date; }
export interface Logger { info(msg: string, ctx?: Record<string, unknown>): void; warn(msg: string, ctx?: Record<string, unknown>): void; error(msg: string, ctx?: Record<string, unknown>): void; }
