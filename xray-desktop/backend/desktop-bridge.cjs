#!/usr/bin/env node

const { AgentCore, AgentError, formatAgentError } = require('xray-client-agent');

function reply(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main() {
  const action = process.argv[2];
  const payloadRaw = process.argv[3] ?? '{}';
  const payload = JSON.parse(payloadRaw);
  const core = new AgentCore();

  switch (action) {
    case 'importToken': {
      const baseUrl = String(payload.baseUrl ?? '');
      const token = String(payload.token ?? '');
      await core.importToken(baseUrl, token);
      return null;
    }
    case 'connect': {
      return core.connect();
    }
    case 'setMode': {
      const mode = String(payload.mode ?? '');
      if (mode !== 'proxy' && mode !== 'vpn') {
        throw new Error('Invalid mode. Expected proxy or vpn');
      }
      return core.setMode(mode);
    }
    case 'disconnect': {
      await core.disconnect();
      return null;
    }
    case 'updateDisguise': {
      const baseUrl = String(payload.baseUrl ?? '');
      const serverId = String(payload.serverId ?? '');
      const adminApiKey = String(payload.adminApiKey ?? '');
      const disguise = payload.disguise;
      return updateDisguise(baseUrl, serverId, adminApiKey, disguise);
    }
    case 'status': {
      return core.status();
    }
    default:
      throw new Error(`Unsupported bridge action: ${action ?? 'undefined'}`);
  }
}

async function updateDisguise(baseUrl, serverId, adminApiKey, disguise) {
  if (!baseUrl) throw new Error('baseUrl is required');
  if (!serverId) throw new Error('serverId is required');
  if (!adminApiKey) throw new Error('adminApiKey is required');
  if (!disguise || typeof disguise !== 'object') throw new Error('disguise payload is required');

  const target = new URL(`/servers/${encodeURIComponent(serverId)}/xray-disguise`, baseUrl).toString();
  const response = await fetch(target, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminApiKey}`,
      accept: 'application/json',
    },
    body: JSON.stringify(disguise),
  });

  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    throw new Error(`Disguise update failed: HTTP ${response.status}${body ? ` ${body}` : ''}`);
  }

  return response.json();
}

void main()
  .then((data) => {
    reply({ ok: true, data });
  })
  .catch((error) => {
    const message =
      error instanceof AgentError
        ? formatAgentError(error)
        : error instanceof Error
          ? error.message
          : String(error);

    reply({ ok: false, error: message });
    process.exitCode = 1;
  });
