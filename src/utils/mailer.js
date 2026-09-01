const nodemailer = require('nodemailer')
const { isProd } = require('./env')
const { renderEmail } = require('./emailTemplate')

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
        console.log('\n[mailer:dev] Email not sent (no SMTP_HOST configured)')
        console.log(`[mailer:dev] To: ${opts.to}`)
        console.log(`[mailer:dev] Subject: ${opts.subject}`)
        console.log(`[mailer:dev] ${opts.text}`)
        return { messageId: 'dev-noop' }
      },
    }
  } else {
    throw new Error('SMTP_HOST is not set in .env - cannot send email in production.')
  }

  return transporter
}

async function sendVerificationEmail(to, token) {
  const baseUrl = process.env.APP_URL || 'https://localhost:4000'
  const link = `${baseUrl}/verify-email.html?token=${token}`

  const html = renderEmail({
    preheader: 'Confirme ton adresse e-mail pour activer ton compte SnipeIT.',
    title: 'Bienvenue sur SnipeIT !',
    bodyHtml: `
      <p style="margin:0 0 12px;">Merci de ton inscription. Confirme ton adresse e-mail pour activer ton compte
      (le lien est valable 24h) :</p>
    `,
    cta: { label: 'Confirmer mon e-mail', url: link },
    footerNote: `Si tu n'es pas à l'origine de cette inscription, ignore simplement cet e-mail.
      Le lien ne fonctionne pas ? Copie-colle celui-ci : <a href="${link}" style="color:#7893CC;">${link}</a>`,
  }, baseUrl)

  await getTransporter().sendMail({
    from: process.env.MAIL_FROM || 'SnipeIT <no-reply@snipeit.local>',
    to,
    subject: 'Confirme ton adresse e-mail - SnipeIT',
    text: `Bienvenue sur SnipeIT !\n\nConfirme ton adresse e-mail en cliquant sur ce lien (valable 24h) :\n${link}\n\nSi tu n'es pas à l'origine de cette inscription, ignore cet e-mail.`,
    html,
  })
}

module.exports = { sendVerificationEmail }
