// EMAIL_REDIRECT_TO (set only in the local .env): every e-mail goes to that
// one address instead of its real recipients - the dev database is a copy
// of production, with real members' addresses in it. The subject shows who
// it was meant for, e.g. "[DEV → kiss.bela@example.com, +3] Tábori levél".
// Without the setting (the live server) the e-mail is left as it is.
export function redirectEmail(options, redirectTo) {
  if (!redirectTo) return options;
  const recipients = [].concat(options.to ?? []);
  const meantFor =
    recipients.length > 1
      ? `${recipients[0]}, +${recipients.length - 1}`
      : recipients[0] || 'senki';
  return {
    ...options,
    to: redirectTo,
    cc: undefined,
    bcc: undefined,
    subject: `[DEV → ${meantFor}] ${options.subject}`,
  };
}
