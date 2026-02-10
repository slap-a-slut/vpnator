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
    case 'disconnect': {
      await core.disconnect();
      return null;
    }
    case 'status': {
      return core.status();
    }
    default:
      throw new Error(`Unsupported bridge action: ${action ?? 'undefined'}`);
  }
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
