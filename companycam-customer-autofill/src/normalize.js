// Pure helpers. No I/O.

/** Trim and collapse internal whitespace. */
export function collapseWhitespace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Key used to compare a CompanyCam project name with a monday item name. */
export function nameKey(s) {
  return collapseWhitespace(s).toLowerCase();
}

/**
 * Normalize a US phone to E.164.
 * 10 digits -> +1XXXXXXXXXX; 11 digits starting with 1 -> +1XXXXXXXXXX; anything else -> null (invalid).
 */
export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** Last 10 digits of any phone string (used to match E.164 and legacy bare-10-digit records alike). */
export function last10(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/** Lowercased, trimmed email, or null if it doesn't look like one. */
export function normalizeEmail(raw) {
  const e = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}
