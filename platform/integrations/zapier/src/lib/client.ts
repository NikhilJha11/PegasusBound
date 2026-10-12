import type { Bundle, ZObject } from './types';

// Base URLs. Production defaults; override per-environment with
// `zapier env:set PEGASUSBOUND_API_BASE=... PEGASUSBOUND_APP_BASE=...`.
export const API_BASE =
  process.env.PEGASUSBOUND_API_BASE || 'https://api.pegasusbound.com/v1';
export const APP_BASE =
  process.env.PEGASUSBOUND_APP_BASE || 'https://app.pegasusbound.com';

// Build a full API URL from a leading-slash path (e.g. api('/contacts')).
export const api = (path: string): string => `${API_BASE}${path}`;

// Scopes the integration requests at consent time. One vocabulary: these are
// the lowercased Pegasusbound API-permission names. Kept to least-privilege for the
// triggers/actions actually shipped (no webhooks/realtime: triggers poll).
export const DEFAULT_SCOPES = [
  'read_emails',
  'write_emails',
  'send_campaigns',
  'read_campaigns',
  'write_campaigns',
  'read_contacts',
  'write_contacts',
  'bulk_contacts',
  'read_unibox',
  'write_unibox',
  'read_crm',
  'write_crm',
  'read_templates',
  'write_templates',
  'read_analytics',
].join(' ');

// OAuth client credentials. Set once with `zapier env:set CLIENT_ID=... CLIENT_SECRET=...`.
export const clientId = (): string =>
  process.env.CLIENT_ID || process.env.PEGASUSBOUND_CLIENT_ID || '';
export const clientSecret = (): string =>
  process.env.CLIENT_SECRET || process.env.PEGASUSBOUND_CLIENT_SECRET || '';

// beforeRequest: attach the bearer token to every API call.
export const includeBearerToken = (request: any, _z: ZObject, bundle: Bundle) => {
  const token = bundle.authData && (bundle.authData as any).access_token;
  if (token) {
    request.headers = request.headers || {};
    request.headers.Authorization = `Bearer ${token}`;
  }
  return request;
};

// afterResponse: turn Pegasusbound's error envelope into a readable Zapier error and
// trigger token refresh on 401. Requests that want to inspect a non-2xx status
// themselves (e.g. a search that treats 404 as "no match") set
// `skipThrowForStatus: true` on the request options.
export const handleApiErrors = (response: any, z: ZObject) => {
  if (response.skipThrowForStatus) {
    return response;
  }
  if (response.status === 401) {
    throw new z.errors.RefreshAuthError('Pegasusbound session expired; reconnect.');
  }
  if (response.status >= 400) {
    let body: any = {};
    try {
      body = response.json || {};
    } catch {
      body = {};
    }
    const detail =
      body.message || body.error || response.content || 'Request failed';
    const code = body.code ? ` [${body.code}]` : '';
    const requestId = body.request_id ? ` (request_id ${body.request_id})` : '';
    throw new z.errors.Error(
      `Pegasusbound API error ${response.status}: ${detail}${code}${requestId}`,
      body.code || 'PegasusboundError',
      response.status,
    );
  }
  return response;
};

// Drop keys whose value is undefined, null, or an empty string so a PATCH only
// sends fields the user actually filled in (Pegasusbound treats omitted fields as
// "leave as-is"). Empty arrays/objects and `false`/`0` are preserved.
export const pruneEmpty = (obj: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    out[key] = value;
  }
  return out;
};

// Pull the array out of a `{ data: [...] }` list envelope (or a bare array).
export const listData = (response: any): any[] => {
  const payload = response && response.data;
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.data)) {
    return payload.data;
  }
  return [];
};
