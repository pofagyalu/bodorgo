import nodemailer from 'nodemailer';
import pug from 'pug';
import { convert } from 'html-to-text';
import config from '../config';

export default class Email {
  constructor(user, url) {
    this.to = user.email;
    this.firstName = user.firstName;
    this.url = url;
    this.from = `Melinda<${config.email.from}>`;
  }

  newTransport() {
    if (config.nodeEnv === 'production') {
      return nodemailer.createTransport({
        service: 'SendGrid',
        auth: {
          user: config.sendgrid.user,
          pass: config.sendgrid.password,
        },
      });
    }

    return nodemailer.createTransport({
      host: config.mailtrap.host,
      port: config.mailtrap.port,
      auth: {
        user: config.mailtrap.user,
        pass: config.mailtrap.password,
      },
    });
  }

  async send(template, subject) {
    const html = pug.renderFile(`${__dirname}/templates/${template}.pug`, {
      name: this.firstName,
      url: this.url,
      subject,
    });

    const mailOptions = {
      from: this.from,
      to: this.to,
      subject,
      html,
      text: convert(html),
    };

    await this.newTransport().sendMail(mailOptions);
  }

  async sendWelcome() {
    await this.send('welcome', 'Üdvözöllek a bódorgó klánban');
  }

  async sendPasswordReset() {
    await this.send(
      'passwordReset',
      'Jelszó helyreállító token (10percig érvényes)',
    );
  }
}
