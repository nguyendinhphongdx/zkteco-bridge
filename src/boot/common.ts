import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const SERVICE_NAME = 'zk-bridge';

export interface RunPaths {
  /** Absolute path to the project directory (`services/zk-bridge`). */
  projectDir: string;
  /** Absolute path to compiled entry (dist/index.js). */
  entry: string;
  /** Absolute path to node binary that should run the entry. */
  nodeBin: string;
  /** Working dir for the service — same as projectDir. */
  workDir: string;
}

export function resolveRunPaths(): RunPaths {
  // When ts-node compiles, __dirname is .../src/boot. After build it's .../dist/boot.
  // Project dir = two levels up.
  const projectDir = path.resolve(__dirname, '..', '..');
  const entry = path.join(projectDir, 'dist', 'index.js');
  const nodeBin = process.execPath;
  return { projectDir, entry, nodeBin, workDir: projectDir };
}

export async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileP(cmd, args, { windowsHide: true });
}

export function writeFileEnsureDir(file: string, content: string, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode });
}
