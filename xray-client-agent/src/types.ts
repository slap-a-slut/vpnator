export interface ImportedSharePayload {
  userId: string;
  serverId: string;
  vlessLink: string;
  meta?: unknown;
  importedAt: string;
  baseUrl: string;
}

export interface ManagedProcess {
  pid: number;
  startedAt: string;
  binary: string;
  configPath: string;
}

export interface SupervisorProcess {
  pid: number;
  startedAt: string;
}

export interface ProxyState {
  enabled: boolean;
  method: string;
  updatedAt: string;
}

export interface AgentState {
  version: 1;
  imported?: ImportedSharePayload;
  process?: ManagedProcess;
  supervisor?: SupervisorProcess;
  proxy?: ProxyState;
  lastError?: string;
  updatedAt: string;
}
