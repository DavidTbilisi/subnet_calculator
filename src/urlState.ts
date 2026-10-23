// page state kept in the URL hash, so a link reopens the same view

import type { VlsmRequest } from './subnet';

export interface PageState {
  ip: string;                // terminal input, '' for the example
  parent: number | null;     // parent prefix, null for the default
  mode: 'equal' | 'vlsm';
  net: string;               // VLSM network, '' for the default
  requests: VlsmRequest[];
  allow31: boolean;
}

// only what differs from a fresh page; VLSM settings only in VLSM mode
export const encodeState = function(state: PageState): string {
  const params = new URLSearchParams();
  if (state.ip !== '') {
    params.set('ip', state.ip);
  }
  if (state.parent !== null) {
    params.set('parent', String(state.parent));
  }
  if (state.mode === 'vlsm') {
    params.set('mode', 'vlsm');
    if (state.net !== '') {
      params.set('net', state.net);
    }
    state.requests.forEach(request => params.append('s', `${request.name}:${request.hosts}`));
    if (state.allow31) {
      params.set('p31', '1');
    }
  }
  return params.toString();
}

// the state in a hash, with anything missing or malformed taken from the defaults
export const decodeState = function(hash: string, defaults: PageState): PageState {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const parent = params.get('parent');
  // a name may itself contain colons, so the host count is after the last one
  const requests = params.getAll('s').flatMap(entry => {
    const colon = entry.lastIndexOf(':');
    const hosts = Number(entry.slice(colon + 1));
    return colon >= 0 && Number.isInteger(hosts) ? [{ name: entry.slice(0, colon), hosts }] : [];
  });

  return {
    ip: params.get('ip') ?? defaults.ip,
    parent: parent !== null && /^\d{1,3}$/.test(parent) && parseInt(parent) <= 128 ? parseInt(parent) : defaults.parent,
    mode: params.get('mode') === 'vlsm' ? 'vlsm' : defaults.mode,
    net: params.get('net') ?? defaults.net,
    requests: params.has('s') ? requests : defaults.requests,
    allow31: params.has('p31') ? params.get('p31') === '1' : defaults.allow31,
  };
}
