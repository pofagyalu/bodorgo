// One call to Authentik's REST API with the token of the `bodorgo-app`
// service account (Beállítások → OIDC szolgáltató, utils/oidcSettings.js).
// Its role may do only what the app needs: invitations
// (utils/authentikInvitations.js), and seeing users and their login
// sessions (utils/authentikSessions.js). A 404 counts as "not there" (null).
export async function authentikApi(settings, path, options = {}) {
  const res = await fetch(`${settings.serverUrl}/api/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${settings.apiToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`Authentik ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.status === 204 || res.status === 404 ? null : res.json();
}
