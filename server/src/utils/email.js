import nodemailer from 'nodemailer';
import config from '../config.js';

const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    host: config.mailtrap.host,
    port: config.mailtrap.port,
    auth: {
      user: config.mailtrap.user,
      pass: config.mailtrap.password,
    },
  });

  const mailOptions = {
    from: config.mailtrap.from,
    to: options.email,
    subject: options.subject,
    text: options.message,
    // html:
  };

  await transporter.sendMail(mailOptions);
};

export default sendEmail;
