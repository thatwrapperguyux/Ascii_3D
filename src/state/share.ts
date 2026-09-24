import { sanitizeSettings, type Settings } from './schema';

/** Settings → URL-safe base64 of their JSON (UTF-8 safe, so custom glyph sets survive). */
export function encodeSettings(settings: Partial<Settings>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(settings));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The inverse of {@link encodeSettings}. Invalid input yields an empty object, never a throw. */
export function decodeSettings(encoded: string): Partial<Settings> {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return sanitizeSettings(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return {};
  }
}

const STORAGE_KEY = 'ascii3d:settings:v1';

/** Browser storage can be unavailable (private mode, sandboxed frames); every access is guarded. */
export function loadStoredSettings(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function storeSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage is a convenience; ignore failures.
  }
}

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(`ascii3d:${key}`);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`ascii3d:${key}`, value);
  } catch {
    // ignore
  }
}
