// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const http = require('http') as typeof import('http');

import type { QmdClient } from './base';
import type {
  QmdResult,
  QmdDocument,
  QmdStatus,
  SearchOptions,
} from './types';
import {
  readPidFile,
  isProcessAlive,
  spawnDaemon,
  waitForEndpoint,
} from '../util/daemon';
import type { ChildProcess } from 'child_process';

const MODE_TOOL: Record<SearchOptions['mode'], string> = {
  keyword: 'structured_search',
  semantic: 'structured_search',
  hybrid: 'query',
};

interface JsonRpcResponse {
  result?: {
    content?: Array<{ type: string; text?: string }>;
  };
  error?: { message: string };
}

export class McpQmdClient implements QmdClient {
  private daemon: ChildProcess | null = null;
  private spawned = false;
  private initAbort: AbortController | null = null;

  constructor(
    private readonly binary: string = 'qmd',
    private readonly port: number = 8181,
  ) {}

  async init(): Promise<void> {
    this.initAbort = new AbortController();

    // Validate binary before spawning — spawning a non-existent file in
    // Electron's renderer corrupts IPC channel state.
    if ((this.binary.includes('/') || this.binary.includes('\\')) && !fs.existsSync(this.binary)) {
      throw new Error(`qmd binary not found: ${this.binary}`);
    }

    const existingPid = readPidFile();
    if (existingPid !== null && isProcessAlive(existingPid)) {
      return;
    }

    this.daemon = spawnDaemon(this.binary, this.port);
    this.spawned = true;
    await waitForEndpoint(this.port, this.initAbort.signal);
  }

  private rpc(tool: string, args: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: tool, arguments: args },
        id: 1,
      });

      const req = http.request(
        { hostname: '127.0.0.1', port: this.port, path: '/mcp', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            try {
              const text = Buffer.concat(chunks).toString('utf8');
              if (!res.statusCode || res.statusCode >= 400) {
                reject(new Error(`MCP HTTP error ${res.statusCode}: ${text}`));
                return;
              }
              const json = JSON.parse(text) as JsonRpcResponse;
              if (json.error) { reject(new Error(`MCP error: ${json.error.message}`)); return; }
              const content = json.result?.content;
              if (!content?.length) { resolve(null); return; }
              const textPart = content.find((c) => c.type === 'text');
              resolve(textPart?.text ? JSON.parse(textPart.text) : null);
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  async search(opts: SearchOptions): Promise<QmdResult[]> {
    const tool = MODE_TOOL[opts.mode];
    const args: Record<string, unknown> = { query: opts.query };
    if (opts.collection) args['collection'] = opts.collection;
    if (opts.intent) args['intent'] = opts.intent;
    if (opts.limit) args['limit'] = opts.limit;

    const result = (await this.rpc(tool, args)) as { results?: QmdResult[] } | null;
    return result?.results ?? [];
  }

  async get(pathOrDocid: string): Promise<QmdDocument> {
    const result = await this.rpc('get', { path: pathOrDocid });
    return result as QmdDocument;
  }

  async status(): Promise<QmdStatus> {
    const result = (await this.rpc('status', {})) as Partial<QmdStatus> | null;
    return {
      healthy: result?.healthy ?? true,
      message: result?.message ?? 'OK',
      collections: result?.collections ?? [],
    };
  }

  async dispose(): Promise<void> {
    this.initAbort?.abort();
    if (this.spawned && this.daemon) {
      this.daemon.kill();
      this.daemon = null;
    }
  }
}
