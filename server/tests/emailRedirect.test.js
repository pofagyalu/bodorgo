import { describe, it, expect } from 'vitest';
import { redirectEmail } from '../src/utils/emailRedirect.js';

describe('redirectEmail (EMAIL_REDIRECT_TO)', () => {
  const email = { to: 'kiss.bela@example.com', subject: 'Tábori levél', html: '<p>Szia</p>' };

  it('leaves the e-mail alone without a redirect address (the live server)', () => {
    expect(redirectEmail(email, undefined)).toBe(email);
    expect(redirectEmail(email, '')).toBe(email);
  });

  it('sends it only to the redirect address, the subject naming the real recipient', () => {
    const out = redirectEmail(email, 'me@example.com');
    expect(out.to).toBe('me@example.com');
    expect(out.subject).toBe('[DEV → kiss.bela@example.com] Tábori levél');
    expect(out.html).toBe('<p>Szia</p>');
  });

  it('several recipients: the first one and how many more', () => {
    const out = redirectEmail(
      { ...email, to: ['a@example.com', 'b@example.com', 'c@example.com'] },
      'me@example.com',
    );
    expect(out.to).toBe('me@example.com');
    expect(out.subject).toBe('[DEV → a@example.com, +2] Tábori levél');
  });

  it('drops cc/bcc, so nobody else gets a copy', () => {
    const out = redirectEmail(
      { ...email, cc: 'x@example.com', bcc: ['y@example.com'] },
      'me@example.com',
    );
    expect(out.cc).toBeUndefined();
    expect(out.bcc).toBeUndefined();
  });
});
