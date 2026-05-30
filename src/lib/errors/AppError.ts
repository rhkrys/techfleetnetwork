/**
 * Typed error hierarchy. Every throw site in app/service code should extend
 * AppError so callers can branch on instanceof rather than parsing strings.
 *
 * Why this exists (May 2026 triage refactor):
 *   The historical agent_fix_queue had 39 "[object Object]" reports and 51
 *   "Failed to save application" reports — both caused by loose `throw err`
 *   where err was a Supabase `{code,message,details,hint}` object, not an
 *   Error. Typed errors + `toError(unknown)` (see ./toError.ts) make that
 *   class of bug impossible.
 */
export class AppError extends Error {
  readonly code: string;
  readonly retriable: boolean;
  readonly details?: Record<string, unknown>;
  constructor(
    message: string,
    opts: { code?: string; retriable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = opts.code ?? "app_error";
    this.retriable = opts.retriable ?? false;
    this.details = opts.details;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export class NetworkError extends AppError {
  constructor(message = "Network request failed", opts: { cause?: unknown } = {}) {
    super(message, { code: "network", retriable: true, cause: opts.cause });
    this.name = "NetworkError";
  }
}

export class TimeoutError extends AppError {
  constructor(message = "Request timed out", opts: { cause?: unknown } = {}) {
    super(message, { code: "timeout", retriable: true, cause: opts.cause });
    this.name = "TimeoutError";
  }
}

export class EdgeInvokeError extends AppError {
  readonly fnName: string;
  readonly status?: number;
  constructor(fnName: string, message: string, opts: { status?: number; retriable?: boolean; cause?: unknown } = {}) {
    super(message, { code: "edge_invoke_failed", retriable: opts.retriable ?? false, cause: opts.cause });
    this.name = "EdgeInvokeError";
    this.fnName = fnName;
    this.status = opts.status;
  }
}

export class RpcError extends AppError {
  readonly rpcName: string;
  readonly pgCode?: string;
  constructor(rpcName: string, message: string, opts: { pgCode?: string; cause?: unknown } = {}) {
    super(message, { code: "rpc_failed", retriable: false, cause: opts.cause });
    this.name = "RpcError";
    this.rpcName = rpcName;
    this.pgCode = opts.pgCode;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", opts: { details?: Record<string, unknown>; cause?: unknown } = {}) {
    super(message, { code: "validation", retriable: false, details: opts.details, cause: opts.cause });
    this.name = "ValidationError";
  }
}

export class AuthError extends AppError {
  constructor(message = "Authentication required", opts: { cause?: unknown } = {}) {
    super(message, { code: "auth", retriable: false, cause: opts.cause });
    this.name = "AuthError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, opts: { cause?: unknown } = {}) {
    super(`${resource} not found`, { code: "not_found", retriable: false, cause: opts.cause });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict with current state", opts: { cause?: unknown } = {}) {
    super(message, { code: "conflict", retriable: false, cause: opts.cause });
    this.name = "ConflictError";
  }
}

export class SerializationError extends AppError {
  constructor(message: string, opts: { cause?: unknown } = {}) {
    super(message, { code: "serialization", retriable: false, cause: opts.cause });
    this.name = "SerializationError";
  }
}
