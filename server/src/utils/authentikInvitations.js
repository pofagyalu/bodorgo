import config from '../config.js';

// Authentik invitations (Felhasználók → Meghívók): each person the club
// adds gets their own single-use link to Authentik's invitation-only
// registration flow, their e-mail and name already filled in. Created
// through Authentik's REST API with the token of the `bodorgo-app` service
// account, whose role may only add/view/delete invitations (see the
// README's "Access and roles"). The flow (slug `enrollment-invitation`):
// invitation check -> registration form -> account (into the `bodorgo`
// group, inactive) -> e-mail confirmation -> login.

export const INVITATION_DAYS = 30;

const base = () => String(config.oridzs.server ?? '').replace(/\/$/, '');

export const invitationsEnabled = () => !!(config.oridzs.server && config.authentik.apiToken);

async function api(path, options = {}) {
  const res = await fetch(`${base()}/api/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.authentik.apiToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`Authentik ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.status === 204 || res.status === 404 ? null : res.json();
}

// A new single-use invitation for this person; { id, link, expiresAt }.
export async function createInvitation({ email, name }) {
  const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);
  const invitation = await api('/stages/invitation/invitations/', {
    method: 'POST',
    body: JSON.stringify({
      name: `bodorgo-${email.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now()}`,
      expires: expiresAt.toISOString(),
      single_use: true,
      // Pre-fills the registration form (its field keys).
      fixed_data: { email, name, username: email },
    }),
  });
  return {
    id: invitation.pk,
    link: `${base()}/if/flow/${config.authentik.invitationFlow}/?itoken=${invitation.pk}`,
    expiresAt,
  };
}

// Gone already (used, expired and cleaned up) counts as done.
export async function deleteInvitation(id) {
  await api(`/stages/invitation/invitations/${id}/`, { method: 'DELETE' });
}
