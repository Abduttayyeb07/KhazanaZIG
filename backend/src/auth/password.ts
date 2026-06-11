import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";

const KEY_LEN = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function validateEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

export function validatePassword(password: string): string | null {
  if (password.length < 12) return "password must be at least 12 characters";
  if (password.length > 128) return "password must be at most 128 characters";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "password must include uppercase, lowercase, and number";
  }
  return null;
}

export function generatePassword(): string {
  return `${randomBytes(9).toString("base64url")}A1`;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const key = await scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = encoded.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function scrypt(password: string, salt: string, keylen: number, options: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}
