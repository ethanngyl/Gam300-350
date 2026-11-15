/*!************************************************************************
\file mail.js
\author Gabriel Sebastian Putra
\par DP email: gabrielsebastian.p@digipen.edu
\par Course: csd3401f26
\par Software Engineering Project 5
\date 15-11-2026
\brief
Business logic: sending email (password reset codes), with nodemailer over
SMTP -- for example a Gmail account with an app password (SMTP_* in .env,
see .env.example). Only the VM (or a machine in local mode) sends email;
team machines ask the VM. No req / res. Plain-text emails only: no links,
no images, no tracking.
- mailReady()
Whether this machine can send email: SMTP settings, or MAIL_OUTBOX_DIR.
- sendMail({ to, subject, text })
Sends one email. With MAIL_OUTBOX_DIR set (tests, development) it writes
the email to a JSON file in that folder instead. Throws if it fails.
- Run as a script: node services/mail.js you@example.com
Sends one test email, to check the SMTP settings (npm run mail:test).
**************************************************************************/

// ----- Headers ------------------------------------------------------- //
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import { config } from '../config.js'

// Made on first use, then reused (it keeps the SMTP settings).
let transport = null

// ----- Start of Functions --------------------------------------------------- //

/************************************************************************/
/*!
  \brief
    Whether this machine can send email.
  \return
    bool
*/
/************************************************************************/
export function mailReady() {
    return Boolean(config.mailOutboxDir) ||
        Boolean(config.smtpHost && config.smtpUser && config.smtpPass && config.mailFrom)
}

/************************************************************************/
/*!
  \brief
    Sends one plain-text email (or, with MAIL_OUTBOX_DIR, writes it to
    <outbox>/<time>-<random>.json as { from, to, subject, text, sentAt }).
  \param message
    { to, subject, text }
  \return
    Promise, resolved once the SMTP server has accepted the email. Throws
    if email isn't set up or the server refuses it.
*/
/************************************************************************/
export async function sendMail({ to, subject, text }) {
    if (!mailReady()) throw new Error('Email is not set up on this machine (SMTP_HOST, SMTP_USER, SMTP_PASS).')
    const from = config.mailFrom || 'Genesis <genesis@localhost>'

    if (config.mailOutboxDir) {
        fs.mkdirSync(config.mailOutboxDir, { recursive: true })
        const file = path.join(config.mailOutboxDir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`)
        fs.writeFileSync(file, JSON.stringify({ from, to, subject, text, sentAt: Date.now() }, null, 2))
        return
    }

    transport ??= nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        // Port 465 is TLS from the start; 587 starts plain and upgrades
        // (STARTTLS), which nodemailer then requires.
        secure: config.smtpPort === 465,
        requireTLS: config.smtpPort !== 465,
        auth: { user: config.smtpUser, pass: config.smtpPass },
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 30_000,
    })
    await transport.sendMail({ from, to, subject, text })
}

// ----- Test send (npm run mail:test -- you@example.com) ---------------------- //

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const to = process.argv[2]
    if (!to) {
        console.error('Usage: npm run mail:test -- you@example.com')
        process.exit(1)
    }
    if (!mailReady()) {
        console.error('Email is not set up: set SMTP_HOST, SMTP_USER and SMTP_PASS in packages/src/backend/.env (see .env.example).')
        process.exit(1)
    }
    try {
        await sendMail({
            to,
            subject: 'Genesis test email',
            text: 'This is a test email from the Genesis backend. If you can read it, password reset emails will arrive too.\n',
        })
        console.log(`Sent a test email to ${to} through ${config.mailOutboxDir ? `the outbox folder ${config.mailOutboxDir}` : `${config.smtpHost}:${config.smtpPort}`}.`)
    }
    catch (err) {
        console.error(`Could not send: ${err.message}`)
        process.exit(1)
    }
}
