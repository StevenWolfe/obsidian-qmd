import type { QmdResult, QmdDocument, QmdStatus, SearchOptions } from './types';

export interface QmdClient {
  search(opts: SearchOptions): Promise<QmdResult[]>;
  get(pathOrDocid: string): Promise<QmdDocument>;
  status(): Promise<QmdStatus>;
  dispose(): Promise<void>;
}
