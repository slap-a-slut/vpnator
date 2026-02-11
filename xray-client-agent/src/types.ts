export interface ImportedSharePayload {
  userId: string;
  serverId: string;
  vlessLink: string;
  server: {
    host: string;
    port: number;
  };
  reality: {
    publicKey: string;
    serverName: string;
    fingerprint: string;
    shortId: string;
    dest: string;
  };
  user: {
    uuid: string;
  };
  meta: {
    tokenId: string;
    expiresAt: string;
    usedAt: string;
  };
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
  mode?: 'proxy' | 'vpn';
  lastError?: string;
  updatedAt: string;
}
