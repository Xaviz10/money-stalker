import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

export const local = import.meta.env.DEV;
export const apiURL = (import.meta.env.VITE_API_URL || (local ? '/api' : '')).replace(/\/$/, '');
const authority = import.meta.env.VITE_COGNITO_AUTHORITY;
const client = import.meta.env.VITE_COGNITO_CLIENT_ID;
const domain = import.meta.env.VITE_COGNITO_DOMAIN;
export const configured = local || Boolean(apiURL && authority && client && domain);
const callback = new URL(import.meta.env.BASE_URL, location.origin).href;
const manager = !local && configured ? new UserManager({
  authority, client_id: client, redirect_uri: callback, response_type: 'code', scope: 'openid email profile',
  automaticSilentRenew: false, revokeTokenTypes: ['refresh_token'],
  userStore: new WebStorageStateStore({ store: sessionStorage, prefix: 'money-stalker.' }),
  stateStore: new WebStorageStateStore({ store: sessionStorage, prefix: 'money-stalker.state.' }),
}) : undefined;
let initialization: Promise<boolean> | undefined;
export function initializeAuth() { return initialization ??= initialize(); }
async function initialize() {
  if (local) return true;
  if (!manager) return false;
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    try { await manager.signinRedirectCallback(); }
    finally { history.replaceState({}, '', callback + '#/resumen'); }
  }
  await manager.clearStaleState();
  return Boolean(await accessToken());
}
let renewing: Promise<string | undefined> | undefined;
export async function accessToken(): Promise<string | undefined> {
  if (!manager) return undefined;
  const user = await manager.getUser();
  if (!user) return undefined;
  if (!user.expired && (user.expires_in ?? 0) > 30) return user.access_token;
  if (!user.refresh_token) { await manager.removeUser(); return undefined; }
  renewing ??= manager.signinSilent().then(u => u?.access_token).catch(async () => { await manager.removeUser(); return undefined; }).finally(() => { renewing = undefined; });
  return renewing;
}
export const login = async () => { await manager?.signinRedirect(); };
export async function logout() {
  if (!manager) return;
  try { await manager.revokeTokens(['refresh_token']); } catch { /* clear local credentials even when offline */ }
  await manager.removeUser();
  location.assign(`${domain.replace(/\/$/, '')}/logout?client_id=${encodeURIComponent(client)}&logout_uri=${encodeURIComponent(callback)}`);
}
