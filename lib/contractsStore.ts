/**
 * Contracts snapshot store — the SBH27/SBK27 Stooq snapshot lives in kv when
 * the app runs in cloud mode (Render + Supabase), and in data/contracts.json
 * locally. The daily fetch script (on the owner's machine, where Stooq needs
 * a real browser) writes the file AND pushes it to kv when DATABASE_URL is
 * set — the cloud app then reads the freshest copy from Postgres.
 */
import fs from 'fs/promises';
import path from 'path';
import { CLOUD_MODE, kvGet, kvSet } from './db';

const FILE = path.join(process.cwd(), 'data', 'contracts.json');
const KEY = 'contracts-snapshot';

export async function readContractsSnapshot<T = unknown>(): Promise<T | null> {
  if (CLOUD_MODE) {
    const v = await kvGet<T>(KEY);
    if (v) return v;
    // first boot before the fetcher pushes — fall back to the bundled file
  }
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function writeContractsSnapshot(data: unknown): Promise<boolean> {
  if (CLOUD_MODE) return kvSet(KEY, data);
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
}
