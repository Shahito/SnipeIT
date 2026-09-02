const { Resend } = require('resend')
const { isProd } = require('./env')
const { renderEmail } = require('./emailTemplate')

let client = null

function getClient() {
  if (client) return client

  if (process.env.RESEND_API_KEY) {
    client = new Resend(process.env.RESEND_API_KEY)
  } else if (!isProd) {
    client = {
      emails: {
        send: async (opts) => {
          console.log('\n[mailer:dev] Email not sent (no RESEND_API_KEY configured)')
          console.log(`[mailer:dev] To: ${opts.to}`)
          console.log(`[mailer:dev] Subject: ${opts.subject}`)
          console.log(`[mailer:dev] ${opts.text}`)
          return { data: { id: 'dev-noop' }, error: null }
        },
      },
    }
  } else {
    throw new Error('RESEND_API_KEY is not set in .env - cannot send email in production.')
  }

  return client
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

  const { data, error } = await getClient().emails.send({
    from: process.env.MAIL_FROM || 'SnipeIT <no-reply@snipeit.local>',
    to,
    subject: 'Confirme ton adresse e-mail - SnipeIT',
    text: `Bienvenue sur SnipeIT !\n\nConfirme ton adresse e-mail en cliquant sur ce lien (valable 24h) :\n${link}\n\nSi tu n'es pas à l'origine de cette inscription, ignore cet e-mail.`,
    html,
    tags: [{ name: 'category', value: 'verification' }],
  })

  if (error) {
    throw new Error(`Resend failed to send verification email: ${error.message || error.name || 'unknown error'}`)
  }

  return data
}

module.exports = { sendVerificationEmail }