import nodemailer from 'nodemailer';
import config from '../config';

const sendEmail = async (options) => {
  //1 trnasporter
  const transporter = nodemailer.createTransport({
    host: config.mailtrap.host,
    port: config.mailtrap.port,
    auth: {
      user: config.mailtrap.user,
      pass: config.mailtrap.password,
    },
  });

  const mailOptions = {
    from: 'Zoltán Nagy <info@padlasfoto.hu>',
    to: options.email,
    subject: options.subject,
    text: options.message,
    // html:
  };

  await transporter.sendMail(mailOptions);
};

export default sendEmail;
