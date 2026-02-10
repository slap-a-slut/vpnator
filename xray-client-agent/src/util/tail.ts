import { readFile } from 'node:fs/promises';

export async function tailLines(filePath: string, tail: number): Promise<string[]> {
  const normalizedTail = Math.max(1, Math.floor(tail));

  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content
    .split(/\r?\n/)
    .filter((line) => line.length > 0);

  return lines.slice(-normalizedTail);
}
