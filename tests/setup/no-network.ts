/**
 * Global test guard: every test run is offline except for localhost (e.g. DynamoDB Local).
 * This is what guarantees that automated tests make zero live Gemini (or any other) calls.
 * Installed for all Vitest projects through `setupFiles`.
 */
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export class BlockedNetworkError extends Error {
  constructor(host: string) {
    super(`Network access is blocked in tests (attempted host: ${host})`);
    this.name = 'BlockedNetworkError';
  }
}

function assertLocal(host: string | null | undefined): void {
  const h = (host ?? '').toLowerCase();
  if (!LOCAL_HOSTS.has(h)) throw new BlockedNetworkError(h || '<unknown>');
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  assertLocal(new URL(raw, 'http://localhost').hostname);
  return realFetch(input, init);
};

type RequestFn = typeof http.request;
function guard(original: RequestFn, protocol: 'http:' | 'https:'): RequestFn {
  return ((...args: unknown[]) => {
    const [first, second] = args;
    let host: string | undefined;
    if (typeof first === 'string' || first instanceof URL) {
      host = new URL(String(first), `${protocol}//localhost`).hostname;
    } else if (first && typeof first === 'object') {
      const o = first as { hostname?: string; host?: string };
      host = o.hostname ?? o.host?.split(':')[0] ?? 'localhost';
    }
    if (typeof second === 'object' && second && 'hostname' in second) {
      host = (second as { hostname?: string }).hostname ?? host;
    }
    assertLocal(host);
    return (original as (...a: unknown[]) => ReturnType<RequestFn>)(...args);
  }) as RequestFn;
}

http.request = guard(http.request, 'http:');
http.get = guard(http.get, 'http:');
https.request = guard(https.request, 'https:');
https.get = guard(https.get, 'https:');
syncBuiltinESMExports();
