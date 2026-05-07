import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface BootEnv {
  dataDir: string;
  port: number;
  bindHost: string;
}

/**
 * OS-standard user data dir for the bridge:
 *   - Linux:   $XDG_DATA_HOME/zk-bridge  →  ~/.local/share/zk-bridge
 *   - macOS:   ~/Library/Application Support/zk-bridge
 *   - Windows: %APPDATA%\zk-bridge       →  ~/AppData/Roaming/zk-bridge
 */
function osDefaultDataDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'zk-bridge');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'zk-bridge');
  }
  const xdg = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'zk-bridge');
}

/**
 * Pick a data dir using these rules, in order:
 *   1. `DATA_DIR` env var (always wins — covers Docker compose, custom paths)
 *   2. `./data/` next to cwd, if it already exists (dev workflow, docker
 *      bind-mount, tarball install in a chosen dir)
 *   3. OS-standard user data dir, when running from a globally-installed npm
 *      package (binary lives under node_modules) — avoids polluting admin cwd
 *   4. `./data/` next to cwd (dev fallback when no .data/ exists yet)
 */
function resolveDataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);

  const localData = path.resolve(process.cwd(), 'data');
  if (fs.existsSync(localData)) return localData;

  if (__dirname.includes(`${path.sep}node_modules${path.sep}`)) {
    return osDefaultDataDir();
  }

  return localData;
}

export function loadBootEnv(): BootEnv {
  return {
    dataDir: resolveDataDir(),
    port: Number(process.env.PORT ?? '7000'),
    bindHost: process.env.BIND_HOST ?? '127.0.0.1',
  };
}
