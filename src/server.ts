import sha256 from 'sha256';
import aes256 from 'aes256';
import randomString from 'randomstring';
import nodemailer from 'nodemailer';

import ejs from 'ejs';
import path, { resolve } from 'path';

import { GraphQLServer } from 'graphql-yoga';
import { prisma } from 'generated/prisma-client';
import authMiddleware from 'middlewares/authMiddleware';
import { resolvers } from 'resolvers';

import {
  PORT,
  DEBUG,
  JWT_SECRET,
  CS_EMAIL_ADDRESS,
  CS_EMAIL_PASSWORD,
  PRISMA_ENDPOINT,
} from 'dotenv.macro';

const server = new GraphQLServer({
  typeDefs: path.join(__dirname, 'schema.graphql'),
  middlewares: [authMiddleware(JWT_SECRET)],
  context: { prisma },
  resolvers,
});

/**
 * Set express view engine to html and join path.
 */
server.express.set('views', path.join(__dirname, '../html'));
server.express.engine('html', ejs.renderFile);
server.express.set('view engine', 'html');

/**
 * Send reset password link to user's email address.
 */
server.express.get('/reset_email/:email', async (req, res) => {
  if (!req.params.email) {
    res.status(404).end();
  }

  const result = await prisma.user({
    email: req.params.email,
  });

  if (!result) {
    res.status(400);
    res.json({
      status: res.statusCode,
      message: 'no user found',
    });
    return;
  }

  const encrypted = Buffer.from(aes256.encrypt(process.env.PW_RESET_KEY, req.params.email)).toString('base64');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: CS_EMAIL_ADDRESS,
      pass: CS_EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: CS_EMAIL_ADDRESS,
    to: req.params.email,
    subject: 'TalkTalk - Reset Password', // Subject line
    html: `Reset your [TalkTalk] password by clicking → <a href="${PRISMA_ENDPOINT}/reset_password/${encrypted}">RESET PASSWORD</a>`,
  };

  transporter.sendMail(mailOptions, (err, transportRes) => {
    console.log('sendMail');
    if (err) {
      res.status(500);
      res.json({
        status: res.statusCode,
        message: err,
      });
    } else {
      console.log('err', res);
      res.json({
        status: res.statusCode,
        message: JSON.stringify(transportRes),
      });
    }
    transporter.close();
  });
});

/**
 * Reset password when user clicks on sent `${reset password link}`.
 */
server.express.get('/reset_password/:encrypted', async (req, res) => {
  if (!req.params.encrypted) {
    res.status(404).end();
  }
  const decrypted = aes256.decrypt(process.env.PW_RESET_KEY, Buffer.from(req.params.encrypted, 'base64').toString());
  const newPassword = randomString.generate(8);
  try {
    const result = await prisma.updateUser({
      where: {
        email: decrypted,
      },
      data: { passwordDigest: sha256(newPassword) },
    });

    res.render('reset_pw', { password: newPassword });
  } catch (err) {
    res.status(500);
    res.json({
      status: res.statusCode,
      message: err,
    });
  }
});

server
  .start({ port: PORT })
  .then(() => console.log(`Server running on port ${PORT}`))
  .catch((e) => console.error(e));
