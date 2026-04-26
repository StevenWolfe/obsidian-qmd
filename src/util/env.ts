// eslint-disable-next-line @typescript-eslint/no-var-requires
const { execFile } = require('child_process') as typeof import('child_process');
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

  // Homebrew — Apple Silicon (/opt/homebrew) and Intel (/usr/local)
  extra.push('/opt/homebrew/bin', '/opt/homebrew/sbin');

  // Volta node version manager
  extra.push(path.join(home, '.volta', 'bin'));

  // fnm — active shell path is in FNM_MULTISHELL_PATH
  if (process.env.FNM_MULTISHELL_PATH) extra.push(process.env.FNM_MULTISHELL_PATH);

  extra.push(
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
    '/opt/local/bin',   // MacPorts
    '/usr/bin',
    '/bin',
  );

  const current = (process.env.PATH ?? '').split(':').filter(Boolean);
  const seen = new Set(current);
  const appended = extra.filter((p) => !seen.has(p));

  return { ...process.env, PATH: [...current, ...appended].join(':') };
}

/**
 * Resolve the absolute path to the qmd binary.
 *
 * Electron's renderer strips the user's shell PATH, so `qmd` is often not
 * findable via the default PATH even after buildEnv() augmentation (e.g. when
 * installed via Homebrew on a fresh machine or defined as a shell alias/function).
 *
 * Strategy:
 *   1. Scan every dir in the buildEnv() PATH for an executable `qmd`.
 *   2. If not found, spawn the user's login shell and ask it for the path —
 *      this handles Homebrew, Volta, NVM, and custom profile-based PATH setups.
 *
 * Returns the resolved absolute path, or the original hint if nothing is found.
 */
export function resolveQmdBinary(hint = 'qmd'): Promise<string> {
  // User-supplied explicit path — honour it as-is
  if (hint !== 'qmd') return Promise.resolve(hint);

  const env = buildEnv();

  // Step 1: direct filesystem scan
  const dirs = (env.PATH ?? '').split(':').filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, 'qmd');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return Promise.resolve(candidate);
    } catch { /* not here */ }
  }

  // Step 2: login shell lookup — loads ~/.zprofile / ~/.bash_profile etc.
  // Uses `command -v` (resolves aliases to their target command) then `which`
  // as a fallback for plain binaries the shell knows about.
  const userShell = process.env.SHELL || '/bin/zsh';
  const shells = [userShell, '/bin/zsh', '/bin/bash'].filter((s, i, a) => a.indexOf(s) === i);

  return shells.reduce<Promise<string>>(
    (acc, sh) =>
      acc.then((found) => {
        if (found !== 'qmd') return found; // already resolved
        return new Promise<string>((resolve) => {
          execFile(
            sh,
            ['-l', '-c', 'command -v qmd 2>/dev/null || which qmd 2>/dev/null'],
            { timeout: 5000, env },
            (_err, stdout) => {
              const line = stdout.trim().split('\n').find((l) => l.startsWith('/'));
              resolve(line ?? 'qmd');
            },
          );
        });
      }),
    Promise.resolve('qmd'),
  );
}
