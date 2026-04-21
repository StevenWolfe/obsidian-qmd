// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const os = require('os') as typeof import('os');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path') as typeof import('path');
import yaml from 'js-yaml';

interface IndexYml {
  collections?: Array<{ name?: string; [key: string]: unknown }> | Record<string, unknown>;
}

export function getConfigPath(): string {
  return path.join(os.homedir(), '.config', 'qmd', 'index.yml');
}

export function loadCollectionNames(): string[] {
  const configPath = getConfigPath();
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const doc = yaml.load(raw) as IndexYml | null;
    if (!doc) return [];

    if (Array.isArray(doc.collections)) {
      return doc.collections
        .map((c) => (typeof c === 'object' && c !== null ? (c.name as string) : undefined))
        .filter((n): n is string => typeof n === 'string' && n.length > 0);
    }

    if (doc.collections && typeof doc.collections === 'object') {
      return Object.keys(doc.collections);
    }

    return [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[obsidian-qmd] Could not parse index.yml:', err);
    }
    return [];
  }
}
