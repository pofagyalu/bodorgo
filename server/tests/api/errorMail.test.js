import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sendResendEmail from '../../src/utils/resendEmail.js';
import {
  MAIL_EVERY_MS,
  errorMailStateForTests,
  flushErrorMailNow,
  noteError,
  resetErrorMailForTests,
  sendErrorMailForTests,
  startErrorMail,
} from '../../src/utils/errorMail.js';
import { createAdmin } from '../helpers/factories.js';

describe("the server's errors by e-mail to the role manager", () => {
  beforeEach(() => {
    resetErrorMailForTests();
    vi.mocked(sendResendEmail).mockClear();
  });
  afterEach(() => resetErrorMailForTests());

  it('never mails a 4xx answer - those are mostly bots', () => {
    noteError({ message: "404 - Can't find /.env on this server!" });
    noteError({ message: '403 - Nincs jogosultsága.' });
    expect(errorMailStateForTests().pending).toEqual([]);
  });

  it('sends the waiting errors together, to the role manager only', async () => {
    const owner = await createAdmin({ canManageRoles: true });
    await createAdmin(); // another admin: not mailed
    noteError({ message: '500 - boom', timestamp: '2026-10-14 10:00:00' });
    noteError({ message: 'UNCAUGHT EXCEPTION!', stack: 'Error: kaput\n    at x.js:1' });
    await sendErrorMailForTests();

    expect(sendResendEmail).toHaveBeenCalledOnce();
    const mail = vi.mocked(sendResendEmail).mock.calls[0][0];
    expect(mail.to).toEqual([owner.email]);
    expect(mail.subject).toBe('Bódorgó szerver: 2 hiba');
    expect(mail.text).toContain('500 - boom');
    expect(mail.text).toContain('Error: kaput');
    expect(mail.text).toContain('/klub/naplo?lap=fajlok');
    expect(errorMailStateForTests().pending).toEqual([]);
  });

  it('lists 30 errors and counts the rest', async () => {
    await createAdmin({ canManageRoles: true });
    for (let i = 0; i < 35; i++) noteError({ message: `500 - error ${i}` });
    await sendErrorMailForTests();
    const mail = vi.mocked(sendResendEmail).mock.calls[0][0];
    expect(mail.subject).toBe('Bódorgó szerver: 35 hiba');
    expect(mail.text).toContain('még 5 hiba');
  });

  it('keeps the errors for later when the e-mail fails', async () => {
    await createAdmin({ canManageRoles: true });
    vi.mocked(sendResendEmail).mockRejectedValueOnce(new Error('down'));
    noteError({ message: '500 - boom' });
    await sendErrorMailForTests();
    expect(errorMailStateForTests().pending).toHaveLength(1);
  });

  it('on a crash sends at once - but not again within 15 minutes', async () => {
    await createAdmin({ canManageRoles: true });
    startErrorMail();
    noteError({ message: 'UNCAUGHT EXCEPTION! first' });
    await flushErrorMailNow();
    expect(sendResendEmail).toHaveBeenCalledOnce();

    noteError({ message: 'UNCAUGHT EXCEPTION! second' });
    await flushErrorMailNow();
    expect(sendResendEmail).toHaveBeenCalledOnce();
    expect(errorMailStateForTests().pending).toHaveLength(1);
    expect(Date.now() - errorMailStateForTests().lastSent).toBeLessThan(MAIL_EVERY_MS);
  });
});
