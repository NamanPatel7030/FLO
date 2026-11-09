/** The live Flo server. Pairing by code uses it unless "Advanced: custom server" says otherwise. */
export const DEFAULT_SERVER = 'https://flo.hellonaman.com';

// Pairing payload parsing: `flo-pair://<host>/<code>` and manual code entry.

export interface PairTarget {
  /** Absolute base URL of the Flo server, no trailing slash. */
  server: string;
  /** Six digits, no separators. */
  code: string;
}

/** Strip everything except digits ("483 920" -> "483920"). */
export function normalizeCode(input: string): string {
  return (input ?? '').replace(/\D+/g, '');
}

/** True when the input contains exactly six digits (spaces/dashes allowed). */
export function isValidCode(input: string): boolean {
  const raw = (input ?? '').trim();
  if (!/^[\d\s-]+$/.test(raw)) return false;
  return normalizeCode(raw).length === 6;
}

/** Pretty form shown in the UI: "483920" -> "483 920". */
export function formatCode(input: string): string {
  const d = normalizeCode(input).slice(0, 6);
  return d.length > 3 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}

const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?|[^.]+\.local|[^.]+)$/i;

/** Local/LAN hosts are assumed to be plain http dev servers; everything else https. */
export function defaultSchemeFor(host: string): 'http' | 'https' {
  const hostname = host.replace(/:\d+$/, '');
  return PRIVATE_HOST.test(hostname) ? 'http' : 'https';
}

/**
 * Normalise a user-typed server address into an absolute base URL.
 * "flo.app" -> "https://flo.app", "192.168.1.4:3000/" -> "http://192.168.1.4:3000".
 * Returns null when it can't be a URL.
 */
export function normalizeServerUrl(input: string): string | null {
  let s = (input ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null; // other scheme
    const host = s.split('/')[0];
    s = `${defaultSchemeFor(host)}://${s}`;
  }
  const m = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)/i.exec(s);
  if (!m) return null;
  const [, scheme, host, path] = m;
  if (!/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i.test(host)) return null;
  const cleanPath = path.replace(/\/+$/, '');
  return `${scheme.toLowerCase()}://${host.toLowerCase()}${cleanPath}`;
}

/**
 * Parse the QR payload `flo-pair://<host>/<code>`.
 * Also tolerates `flo-pair://<host>/<code>?scheme=http` and a URL-encoded
 * code ("483%20920"). Returns null if it isn't a valid Flo pairing payload.
 */
export function parsePairPayload(payload: string): PairTarget | null {
  const s = (payload ?? '').trim();
  const m = /^flo-pair:\/\/([^/?#\s]+)((?:\/[^/?#]+)*?)\/([^/?#]+)\/?(?:\?([^#]*))?$/i.exec(s);
  if (!m) return null;
  const [, host, basePath, rawCode, query] = m;
  let codePart: string;
  try {
    codePart = decodeURIComponent(rawCode);
  } catch {
    return null;
  }
  if (!isValidCode(codePart)) return null;

  let scheme: string = defaultSchemeFor(host);
  if (query) {
    for (const pair of query.split('&')) {
      const [k, v] = pair.split('=');
      if (k === 'scheme' && (v === 'http' || v === 'https')) scheme = v;
    }
  }
  const server = normalizeServerUrl(`${scheme}://${host}${basePath ?? ''}`);
  if (!server) return null;
  return { server, code: normalizeCode(codePart) };
}
