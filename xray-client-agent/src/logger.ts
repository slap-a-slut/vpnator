import pino from 'pino';

export function createAgentLogger(logFile: string): pino.Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    pino.destination({
      dest: logFile,
      mkdir: true,
      sync: false,
    }),
  );
}
