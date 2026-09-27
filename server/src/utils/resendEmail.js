import { Resend } from 'resend';
import config from '../config.js';
import logger from '../logger.js';
import { redirectEmail } from './emailRedirect.js';

if (config.resend.redirectTo) {
  logger.warn(`EMAIL_REDIRECT_TO is set: every e-mail goes to ${config.resend.redirectTo} only`);
}

// Separate from utils/email.js's Mailtrap/nodemailer transport - that one
// writes into Mailtrap's sandbox inbox (never reaches a real mailbox),
// which is fine for password-reset dev testing but not for anything the
// user actually needs to receive, like an emailed tour PDF.
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
