import { Resend } from 'resend';
import config from '../config.js';
import logger from '../logger.js';
import { redirectEmail } from './emailRedirect.js';

if (config.resend.redirectTo) {
  logger.warn(`EMAIL_REDIRECT_TO is set: every e-mail goes to ${config.resend.redirectTo} only`);
}

// The one way the server sends e-mail (Resend) - every e-mail the app sends
// goes through sendResendEmail below (listed on Klub → Beállítások →
// Értesítések).
let client = null;
function getClient() {
  if (!client) {
    client = new Resend(config.resend.apiKey);
  }
  return client;
}

/**
 * @param {{to: string | string[], subject: string, html: string, text?: string, attachments?: {filename: string, content: Buffer}[]}} options
 */
const sendResendEmail = async (options) => {
  const { to, subject, html, text, attachments } = redirectEmail(options, config.resend.redirectTo);
  const { data, error } = await getClient().emails.send({
    from: config.resend.from,
    to,
    subject,
    html,
    text,
    attachments,
  });

  if (error) {
    throw new Error(`Resend email sending failed: ${error.message || error}`);
  }

  return data;
};

export default sendResendEmail;
