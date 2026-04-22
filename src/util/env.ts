// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const os = require('os') as typeof import('os');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path') as typeof import('path');

// Electron's PATH is stripped down and doesn't include user shell paths.
// This builds a PATH that includes common locations where npm-global tools live.
export function buildEnv(): NodeJS.ProcessEnv {
  const home = os.homedir();
  const extra: string[] = [];

  // NVM_BIN is set when a shell session has nvm active — most reliable
  if (process.env.NVM_BIN) extra.push(process.env.NVM_BIN);

  // Scan ~/.nvm/versions/node/*/bin to catch all installed node versions
  const nvmNodeDir = path.join(home, '.nvm', 'versions', 'node');
  try {
    for (const v of fs.readdirSync(nvmNodeDir)) {
      extra.push(path.join(nvmNodeDir, v, 'bin'));
    }
  } catch { /* no nvm */ }

  extra.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  );

  const current = (process.env.PATH ?? '').split(':').filter(Boolean);
  const seen = new Set(current);
  const appended = extra.filter((p) => !seen.has(p));

  return { ...process.env, PATH: [...current, ...appended].join(':') };
}
