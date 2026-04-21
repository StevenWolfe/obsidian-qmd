export interface QmdResult {
  title: string;
  path: string;
  collection: string;
  score: number;
  snippet: string;
  docid: string;
  line?: number;
}

export interface QmdDocument {
  title: string;
  path: string;
  collection: string;
  content: string;
  docid: string;
}

export interface QmdCollectionStatus {
  name: string;
  docCount: number;
  lastIndexed?: string;
}

export interface QmdStatus {
  healthy: boolean;
  message: string;
  collections: QmdCollectionStatus[];
}

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface SearchOptions {
  query: string;
  mode: SearchMode;
  collection?: string;
  intent?: string;
  limit?: number;
}
