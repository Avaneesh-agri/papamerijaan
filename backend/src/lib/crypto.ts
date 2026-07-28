import crypto from 'crypto';

// ---------- Session tokens ----------
export function newSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------- Vault encryption (AES-256-GCM) ----------
function vaultKey(): Buffer {
  const secret = process.env.VAULT_ENCRYPTION_KEY || 'insecure-dev-vault-key';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const [ivB, tagB, dataB] = stored.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64')), decipher.final()]).toString('utf8');
}

export function generateStrongPassword(len = 14): string {
  const sets = [
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    'abcdefghijkmnopqrstuvwxyz',
    '23456789',
    '!@#$%^&*_-+',
  ];
  const all = sets.join('');
  const pick = (s: string) => s[crypto.randomInt(s.length)];
  let pwd = sets.map(pick).join('');
  while (pwd.length < len) pwd += pick(all);
  return pwd
    .split('')
    .sort(() => crypto.randomInt(3) - 1)
    .join('');
}
