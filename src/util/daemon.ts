// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const os = require('os') as typeof import('os');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path') as typeof import('path');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { spawn } = require('child_process') as typeof import('child_process');

import type { ChildProcess } from 'child_process';

const PID_FILE = path.join(os.homedir(), '.cache', 'qmd', 'mcp.pid');

export function readPidFile(): number | null {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function spawnDaemon(binary: string, port: number): ChildProcess {
  const child = spawn(binary, ['mcp', '--http', '--port', String(port)], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    console.debug('[qmd mcp stdout]', chunk.toString('utf8').trim());
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    console.debug('[qmd mcp stderr]', chunk.toString('utf8').trim());
  });

  return child;
}

export async function waitForEndpoint(
  port: number,
  timeoutMs = 15_000,
  intervalMs = 500,
): Promise<void> {
  const url = `http://localhost:${port}/mcp`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok || res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`qmd MCP daemon did not start within ${timeoutMs}ms on port ${port}`);
}
