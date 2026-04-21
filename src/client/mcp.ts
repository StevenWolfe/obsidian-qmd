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

  constructor(
    private readonly binary: string = 'qmd',
    private readonly port: number = 8181,
  ) {}

  async init(): Promise<void> {
    const existingPid = readPidFile();
    if (existingPid !== null && isProcessAlive(existingPid)) {
      return; // reuse existing daemon
    }

    this.daemon = spawnDaemon(this.binary, this.port);
    this.spawned = true;
    await waitForEndpoint(this.port);
  }

  private get baseUrl(): string {
    return `http://localhost:${this.port}/mcp`;
  }

  private async rpc(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: tool, arguments: args },
      id: 1,
    });

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok) {
      throw new Error(`MCP HTTP error ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as JsonRpcResponse;
    if (json.error) throw new Error(`MCP error: ${json.error.message}`);

    const content = json.result?.content;
    if (!content?.length) return null;

    const textPart = content.find((c) => c.type === 'text');
    if (!textPart?.text) return null;
    return JSON.parse(textPart.text);
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
    if (this.spawned && this.daemon) {
      this.daemon.kill();
      this.daemon = null;
    }
  }
}
