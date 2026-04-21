// eslint-disable-next-line @typescript-eslint/no-var-requires
const { spawn } = require('child_process') as typeof import('child_process');

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

function runQmd(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, { env: process.env });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    proc.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    proc.on('close', (code: number) => {
      if (code !== 0) {
        const errText = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`qmd exited with code ${code}: ${errText}`));
      } else {
        if (stderr.length > 0) {
          console.debug('[qmd stderr]', Buffer.concat(stderr).toString('utf8').trim());
        }
        resolve(Buffer.concat(stdout).toString('utf8'));
      }
    });

    proc.on('error', (err: Error) => reject(err));
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
