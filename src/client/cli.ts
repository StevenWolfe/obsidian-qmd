// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execFile } = require('child_process') as typeof import('child_process');

import type { QmdClient } from './base';
import type {
  QmdResult,
  QmdDocument,
  QmdStatus,
  SearchOptions,
} from './types';
import { log } from '../util/log';
import { buildEnv } from '../util/env';

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
    execFile(binary, args, { timeout: 60_000, maxBuffer: 10 * 1024 * 1024, env: buildEnv() }, (err, stdout, stderr) => {
      if (err) {
        const clean = stripAnsi(err.message);
        log.error('command failed:', clean);
        reject(new Error(clean));
      } else {
        const cleanErr = stderr ? stripAnsi(stderr).trim() : '';
        if (cleanErr) log.warn('stderr:', cleanErr);
        resolve(stdout);
      }
    });
  });
}

function parseStatusText(raw: string): QmdStatus {
  const lines = raw.split('\n');
  const collections: QmdStatus['collections'] = [];

  const totalMatch = raw.match(/Total:\s+(\d+) files indexed/);
  const totalDocs = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  // Collection entries are indented 2 spaces followed by name + (qmd://...)
  // Child properties (Files:, Updated:) are indented 4+ spaces.
  for (let i = 0; i < lines.length; i++) {
    const collMatch = lines[i].match(/^  (\S+)\s+\(qmd:\/\//);
    if (!collMatch) continue;

    const name = collMatch[1];
    let docCount = 0;
    let lastIndexed: string | undefined;

    for (let j = i + 1; j < lines.length && /^ {4}/.test(lines[j]); j++) {
      const filesMatch = lines[j].match(/Files:\s+(\d+)/);
      if (filesMatch) {
        docCount = parseInt(filesMatch[1], 10);
        const inline = lines[j].match(/\(updated (.+?)\)/);
        if (inline) lastIndexed = inline[1];
      }
      const updMatch = lines[j].match(/Updated:\s+(.+)/);
      if (updMatch) lastIndexed = updMatch[1].trim();
    }

    collections.push({ name, docCount, lastIndexed });
  }

  return {
    healthy: true,
    message: `${totalDocs} doc${totalDocs !== 1 ? 's' : ''} indexed`,
    collections,
  };
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
    // qmd status has no --json flag; parse the plain text output.
    const raw = await runQmd(this.binary, ['status']);
    return parseStatusText(raw);
  }

  async dispose(): Promise<void> {
    // no-op for CLI mode
  }
}
