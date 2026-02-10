export type AgentErrorCode =
  | 'XRAY_DOWNLOAD_FAILED'
  | 'XRAY_HASH_MISMATCH'
  | 'XRAY_UNSUPPORTED_PLATFORM'
  | 'STARTUP_FAILED';

export class AgentError extends Error {
  public readonly code: AgentErrorCode;
  public readonly details?: Record<string, unknown>;

  public constructor(params: {
    code: AgentErrorCode;
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.code = params.code;
    if (params.details !== undefined) {
      this.details = params.details;
    }
  }
}

export function formatAgentError(error: AgentError): string {
  return `${error.code}: ${error.message}`;
}
