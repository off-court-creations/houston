import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { canPrompt, promptSecret } from '../lib/interactive.js';

// A thin wrapper around OS keychain (keytar) with a secure file fallback using AES-256-GCM.

type Keytar = {
  getPassword: (service: string, account: string) => Promise<string | null>;
  setPassword: (service: string, account: string, password: string) => Promise<void>;
  deletePassword: (service: string, account: string) => Promise<boolean>;
  findCredentials: (service: string) => Promise<Array<{ account: string; password: string }>>;
};

let keytarModule: Keytar | null | undefined;

async function getKeytar(): Promise<Keytar | null> {
  if (keytarModule !== undefined) return keytarModule;
  try {
    // keytar is optional; avoid hard dependency
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const mod = (await import('keytar')) as Keytar;
    keytarModule = mod;
  } catch {
    keytarModule = null;
  }
  return keytarModule;
}

// Fallback secure file store
const DIR = path.join(os.homedir(), '.config', 'houston');
const FILE = path.join(DIR, 'secrets.json');

type EncEntry = { salt: string; iv: string; data: string };
type EncPayloadV1 = { v: 1; entries: Record<string, EncEntry> };

function readEncFile(): EncPayloadV1 {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw) as EncPayloadV1;
    if (parsed && parsed.v === 1 && parsed.entries && typeof parsed.entries === 'object') {
      return parsed;
    }
  } catch {}
  return { v: 1, entries: {} };
}

function writeEncFile(payload: EncPayloadV1): void {
  fs.mkdirSync(DIR, { recursive: true });
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(FILE, json + (json.endsWith('\n') ? '' : '\n'), { mode: 0o600 });
}

// Options previously allowed custom confirm behavior; simplified away.

async function promptAndConfirm(initialPrompt: string): Promise<string> {
  while (true) {
    const first = (await promptSecret(initialPrompt)).trim();
    if (first === '') {
      console.log('Passphrase is required.');
      continue;
    }
    const second = (await promptSecret('Confirm passphrase')).trim();
    if (first !== second) {
      console.log('Passphrases did not match. Try again.');
      continue;
    }
    return first;
  }
}

function hasStoredEntries(): boolean {
  try {
    if (!fs.existsSync(FILE)) return false;
    const payload = readEncFile();
    return Object.keys(payload.entries).length > 0;
  } catch {
    return false;
  }
}

async function resolvePassphrase(): Promise<string | null> {
  const env = process.env.HOUSTON_PASSPHRASE;
  if (env && env.trim() !== '') return env;
  if (!canPrompt()) return null;
  const existing = hasStoredEntries();
  if (!existing) {
    const initialPrompt = 'Create a passphrase to protect tokens';
    return promptAndConfirm(initialPrompt);
  }

  // Existing store: ask once to unlock
  const pass = await promptSecret('Enter passphrase to unlock secure store');
  const trimmed = pass.trim();
  return trimmed === '' ? null : trimmed;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // Use conservative scrypt params to avoid OpenSSL maxmem errors in constrained envs.
  // These match Node defaults (N=2^14, r=8, p=1) with a higher maxmem budget.
  return crypto.scryptSync(passphrase, salt, 32, {
    N: 1 << 14,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024, // 128 MB
  } as crypto.ScryptOptions);
}

function encrypt(passphrase: string, plaintext: string): EncEntry {
  const salt = crypto.randomBytes(16);
  const key = deriveKey(passphrase, salt);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([enc, tag]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), data: payload.toString('base64') };
}

function decrypt(passphrase: string, entry: EncEntry): string | null {
  try {
    const salt = Buffer.from(entry.salt, 'base64');
    const iv = Buffer.from(entry.iv, 'base64');
    const data = Buffer.from(entry.data, 'base64');
    const key = deriveKey(passphrase, salt);
    const tag = data.subarray(data.length - 16);
    const enc = data.subarray(0, data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

export async function getSecret(service: string, account: string): Promise<string | null> {
  const kt = await getKeytar();
  if (kt) {
    return kt.getPassword(service, account);
  }
  const db = readEncFile();
  const key = `${service}:${account}`;
  const entry = db.entries[key];
  if (!entry) return null;
  const pass = await resolvePassphrase();
  if (!pass) return null;
  return decrypt(pass, entry);
}

export async function setSecret(service: string, account: string, value: string): Promise<void> {
  const kt = await getKeytar();
  if (kt) {
    await kt.setPassword(service, account, value);
    return;
  }
  const pass = await resolvePassphrase();
  if (!pass) throw new Error('No passphrase available to encrypt secret');
  const db = readEncFile();
  db.entries[`${service}:${account}`] = encrypt(pass, value);
  writeEncFile(db);
}

export async function deleteSecret(service: string, account: string): Promise<boolean> {
  const kt = await getKeytar();
  if (kt) {
    return kt.deletePassword(service, account);
  }
  const db = readEncFile();
  const key = `${service}:${account}`;
  if (db.entries[key]) {
    const pass = await resolvePassphrase();
    if (!pass) return false;
    delete db.entries[key];
    writeEncFile(db);
    return true;
  }
  return false;
}

export async function listAccounts(service: string): Promise<string[]> {
  const kt = await getKeytar();
  if (kt) {
    try {
      const creds = await kt.findCredentials(service);
      return creds.map((c) => c.account).sort();
    } catch {
      return [];
    }
  }
  try {
    const db = readEncFile();
    const prefix = `${service}:`;
    return Object.keys(db.entries)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
      .sort();
  } catch {
    return [];
  }
}

export async function backendName(): Promise<string> {
  const kt = await getKeytar();
  return kt ? 'keychain' : 'encrypted-file';
}
