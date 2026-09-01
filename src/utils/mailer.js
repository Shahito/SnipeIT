const nodemailer = require('nodemailer')
const { isProd } = require('./env')

let transporter = null

function getTransporter() {
  if (transporter) return transporter

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    })
  } else if (!isProd) {
    // Dev fallback: no SMTP configured, just log to console instead of sending.
    transporter = {
      sendMail: async (opts) => {
        console.log('\n[mailer:dev] --- Email not sent (no SMTP_HOST configured) ---')
        console.log(`[mailer:dev] To: ${opts.to}`)
        console.log(`[mailer:dev] Subject: ${opts.subject}`)
        console.log(`[mailer:dev] ${opts.text}`)
        console.log('[mailer:dev] -----------------------------------------------\n')
        return { messageId: 'dev-noop' }
      },
    }
  } else {
    throw new Error('SMTP_HOST is not set in .env - cannot send email in production.')
  }

  return transporter
}

async function sendVerificationEmail(to, token) {
  const baseUrl = process.env.APP_URL || 'http://localhost:4000'
  const link = `${baseUrl}/verify-email.html?token=${token}`

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || 'SnipeIT <no-reply@snipeit.local>',
    to,
    subject: 'Confirme ton adresse e-mail - SnipeIT',
    text: `Bienvenue sur SnipeIT !\n\nConfirme ton adresse e-mail en cliquant sur ce lien (valable 24h) :\n${link}\n\nSi tu n'es pas à l'origine de cette inscription, ignore cet e-mail.`,
    html: `
      <p>Bienvenue sur SnipeIT !</p>
      <p>Confirme ton adresse e-mail en cliquant sur le bouton ci-dessous (lien valable 24h) :</p>
      <p><a href="${link}" style="background:#6c8eff;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Confirmer mon e-mail</a></p>
      <p>Ou copie ce lien dans ton navigateur :<br>${link}</p>
      <p>Si tu n'es pas à l'origine de cette inscription, ignore cet e-mail.</p>
    `,
  })
}

module.exports = { sendVerificationEmail }
