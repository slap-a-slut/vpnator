import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrent as getDeepLinks, onOpenUrl } from '@tauri-apps/plugin-deep-link';

import './styles.css';

interface AgentStatus {
  connected: boolean;
  running: boolean;
  pid: number | null;
  supervisorPid: number | null;
  lastError: string | null;
  imported: boolean;
  importedConfig: {
    baseUrl: string;
    serverId: string;
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
  } | null;
  proxyEnabled: boolean;
  mode: 'proxy' | 'vpn';
  logsPath: string;
  agentLogPath: string;
  xrayLogPath: string;
}

interface DeepLinkImportPayload {
  baseUrl: string;
  token: string;
}

const baseUrlInput = must<HTMLInputElement>('baseUrl');
const shareTokenInput = must<HTMLInputElement>('shareToken');
const statusBox = must<HTMLPreElement>('statusBox');
const message = must<HTMLParagraphElement>('message');
const importBtn = must<HTMLButtonElement>('importBtn');
const connectBtn = must<HTMLButtonElement>('connectBtn');
const disconnectBtn = must<HTMLButtonElement>('disconnectBtn');
const copyLogsPathBtn = must<HTMLButtonElement>('copyLogsPathBtn');
const appVersionLabel = must<HTMLParagraphElement>('appVersion');
const modeSelect = must<HTMLSelectElement>('modeSelect');
const disguiseLine = must<HTMLParagraphElement>('disguiseLine');
const disguisePreset = must<HTMLSelectElement>('disguisePreset');
const disguiseCustom = must<HTMLInputElement>('disguiseCustom');
const adminApiKeyInput = must<HTMLInputElement>('adminApiKey');
const applyDisguiseBtn = must<HTMLButtonElement>('applyDisguiseBtn');

let latestStatus: AgentStatus | null = null;

function must<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}

function setMessage(text: string): void {
  message.textContent = text;
}

function renderStatus(status: AgentStatus): void {
  latestStatus = status;
  modeSelect.value = status.mode;
  disguiseLine.textContent = status.importedConfig
    ? `Disguised as traffic from ${status.importedConfig.reality.serverName}`
    : 'Disguised as traffic from -';

  statusBox.textContent = JSON.stringify(
    {
      state: status.connected ? 'Connected' : 'Disconnected',
      lastError: status.lastError,
      pid: status.pid,
      supervisorPid: status.supervisorPid,
      imported: status.imported,
      mode: status.mode,
      logsPath: status.logsPath,
    },
    null,
    2,
  );
}

async function refreshStatus(): Promise<void> {
  const status = await invoke<AgentStatus>('status');
  renderStatus(status);
}

async function withAction(name: string, action: () => Promise<void>): Promise<void> {
  setDisabled(true);
  setMessage(`${name}...`);

  try {
    await action();
    await refreshStatus();
    setMessage(`${name} completed`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    setMessage(`${name} failed: ${text}`);
    await refreshStatus().catch(() => undefined);
  } finally {
    setDisabled(false);
  }
}

function setDisabled(value: boolean): void {
  importBtn.disabled = value;
  connectBtn.disabled = value;
  disconnectBtn.disabled = value;
  copyLogsPathBtn.disabled = value;
  modeSelect.disabled = value;
  applyDisguiseBtn.disabled = value;
  disguisePreset.disabled = value;
  disguiseCustom.disabled = value;
  adminApiKeyInput.disabled = value;
}

function parseImportDeepLink(rawUrl: string): DeepLinkImportPayload {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Malformed deep link URL');
  }

  if (parsed.protocol !== 'xraycp:') {
    throw new Error('Unsupported deep link scheme');
  }

  const action = (parsed.hostname || parsed.pathname.replace(/^\/+/, '')).toLowerCase();
  if (action !== 'import') {
    throw new Error('Unsupported deep link action');
  }

  const baseUrl = (parsed.searchParams.get('baseUrl') ?? '').trim();
  const token = (parsed.searchParams.get('token') ?? '').trim();

  if (!baseUrl) {
    throw new Error('Missing baseUrl parameter');
  }

  if (!token) {
    throw new Error('Missing token parameter');
  }

  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error('Invalid baseUrl parameter');
  }

  if (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https');
  }

  if (!/^[A-Za-z0-9_-]{16,}$/.test(token)) {
    throw new Error('Invalid token format');
  }

  return {
    baseUrl,
    token,
  };
}

async function processDeepLinks(urls: string[]): Promise<void> {
  if (urls.length === 0) return;

  let payload: DeepLinkImportPayload | null = null;
  for (const rawUrl of urls) {
    try {
      payload = parseImportDeepLink(rawUrl);
      break;
    } catch {
      continue;
    }
  }

  if (!payload) {
    setMessage('Deep link ignored: invalid format. Expected xraycp://import?...');
    return;
  }

  await withAction('Import from link', async () => {
    await invoke('importToken', { baseUrl: payload.baseUrl, token: payload.token });
  });

  baseUrlInput.value = payload.baseUrl;
  shareTokenInput.value = '';
  setMessage('Import from deep link completed. Press Connect to start tunnel.');
}

importBtn.addEventListener('click', async () => {
  const baseUrl = baseUrlInput.value.trim();
  const token = shareTokenInput.value.trim();

  await withAction('Import', async () => {
    await invoke('importToken', { baseUrl, token });
  });
});

connectBtn.addEventListener('click', async () => {
  await withAction('Connect', async () => {
    await invoke('connect');
  });
});

disconnectBtn.addEventListener('click', async () => {
  await withAction('Disconnect', async () => {
    await invoke('disconnect');
  });
});

modeSelect.addEventListener('change', async () => {
  const mode = modeSelect.value === 'vpn' ? 'vpn' : 'proxy';
  await withAction(`Set mode ${mode}`, async () => {
    await invoke('setMode', { mode });
  });
});

applyDisguiseBtn.addEventListener('click', async () => {
  const status = latestStatus;
  if (!status?.importedConfig) {
    setMessage('Import config first');
    return;
  }

  const serverId = status.importedConfig.serverId;
  const baseUrl = status.importedConfig.baseUrl;
  const adminApiKey = adminApiKeyInput.value.trim();
  if (!adminApiKey) {
    setMessage('Admin API key is required to apply disguise');
    return;
  }

  const presetValue = disguisePreset.value;
  const domain =
    presetValue === 'custom' ? disguiseCustom.value.trim().toLowerCase() : presetValue.toLowerCase();

  if (!/^(?=.{1,253}$)(?!-)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(domain)) {
    setMessage('Invalid domain format');
    return;
  }

  await withAction('Apply disguise', async () => {
    await invoke('updateDisguise', {
      baseUrl,
      serverId,
      adminApiKey,
      disguise: {
        serverName: domain,
        dest: `${domain}:443`,
        fingerprint: 'chrome',
      },
    });
  });

  setMessage('Disguise update submitted. Reconnect after job completion.');
});

function syncCustomDisguiseInput(): void {
  disguiseCustom.disabled = disguisePreset.value !== 'custom';
}

disguisePreset.addEventListener('change', () => {
  syncCustomDisguiseInput();
});

copyLogsPathBtn.addEventListener('click', async () => {
  const path = latestStatus?.logsPath;
  if (!path) {
    setMessage('No logs path available yet');
    return;
  }

  try {
    await navigator.clipboard.writeText(path);
    setMessage(`Logs path copied: ${path}`);
  } catch {
    setMessage(`Copy failed. Logs path: ${path}`);
  }
});

async function initialize(): Promise<void> {
  syncCustomDisguiseInput();

  try {
    const appVersion = await getVersion();
    appVersionLabel.textContent = `Version: ${appVersion}`;
  } catch {
    appVersionLabel.textContent = 'Version: unknown';
  }

  await refreshStatus();

  try {
    const startUrls = (await getDeepLinks()) ?? [];
    if (startUrls.length > 0) {
      await processDeepLinks(startUrls);
    }

    await onOpenUrl((urls) => {
      void processDeepLinks(urls);
    });
  } catch {
    setMessage('Deep link listener unavailable');
  }
}

void initialize().catch((error) => {
  const text = error instanceof Error ? error.message : String(error);
  statusBox.textContent = `Failed to load status: ${text}`;
});
