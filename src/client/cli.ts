// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execFile } = require('child_process') as typeof import('child_process');

import type { QmdClient } from './base';
import type {
  QmdResult,
  QmdDocument,
  QmdStatus,
  SearchOptions,
} from './types';

const MODE_CMD: Record<SearchOptions['mode'], string> = {
  keyword: 'search',
  semantic: 'vsearch',
  hybrid: 'query',
};

// Strip ANSI/VT100 escape sequences — qmd emits cursor-hide/show codes
// (\x1b[?25l, \x1b[?25h) to stderr when it thinks it's in a TTY, which
// Node embeds verbatim into execFile error messages.
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
const stripAnsi = (s: string) => s.replace(ANSI_RE, '');

function runQmd(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, env: process.env as NodeJS.ProcessEnv }, (err, stdout, stderr) => {
      if (err) {
        const clean = stripAnsi(err.message);
        console.error(`[qmd] command failed: ${clean}`);
        reject(new Error(clean));
      } else {
        const cleanErr = stderr ? stripAnsi(stderr).trim() : '';
        if (cleanErr) console.warn(`[qmd] stderr: ${cleanErr}`);
        resolve(stdout);
      }
    });
  });
}

export class CliQmdClient implements QmdClient {
  constructor(private readonly binary: string = 'qmd') {}

  async search(opts: SearchOptions): Promise<QmdResult[]> {
    const cmd = MODE_CMD[opts.mode];
    const args: string[] = [cmd, opts.query, '--json'];

    if (opts.collection) args.push('-c', opts.collection);
    if (opts.limit) args.push('-n', String(opts.limit));
    if (opts.intent) args.push('--intent', opts.intent);

    const raw = await runQmd(this.binary, args);
    const parsed = JSON.parse(raw) as { results?: QmdResult[] };
    return parsed.results ?? [];
  }

  async get(pathOrDocid: string): Promise<QmdDocument> {
    const args = ['get', pathOrDocid, '--json'];
    const raw = await runQmd(this.binary, args);
    return JSON.parse(raw) as QmdDocument;
  }

  async status(): Promise<QmdStatus> {
    const raw = await runQmd(this.binary, ['status', '--json']);
    const parsed = JSON.parse(raw) as Partial<QmdStatus>;
    return {
      healthy: parsed.healthy ?? true,
      message: parsed.message ?? 'OK',
      collections: parsed.collections ?? [],
    };
  }

  async dispose(): Promise<void> {
    // no-op for CLI mode
  }
}
