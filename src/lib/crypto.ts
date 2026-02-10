import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { env } from './env';

export function randomId(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

export function sha256Hex(data: string) {
  return createHash('sha256').update(data).digest('hex');
}

export function safeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

const AES_256_GCM_IV_BYTES = 12;

let cachedMasterKey: Buffer | null = null;
function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const key = Buffer.from(env.MASTER_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('MASTER_KEY must be base64-encoded 32 bytes');
  }
  cachedMasterKey = key;
  return key;
}

export function encryptSecret(plaintext: string) {
  const key = getMasterKey();
  const iv = randomBytes(AES_256_GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(ciphertext: string) {
  const key = getMasterKey();
  const parts = ciphertext.split('.');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');

  const [ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid ciphertext format');

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export function randomBase64Url(bytes: number) {
  return randomBytes(bytes).toString('base64url');
}

export function generateShareTokenPlaintext() {
  return randomBase64Url(32);
}

export function hashShareToken(plaintextToken: string, tokenSalt = env.TOKEN_SALT) {
  return createHash('sha256').update(tokenSalt).update('\0').update(plaintextToken).digest('hex');
}
