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

const EMAIL_STRINGS = {
  fr: {
    preheader: 'Confirme ton adresse e-mail pour activer ton compte SnipeIT.',
    title: 'Bienvenue sur SnipeIT !',
    bodyHtml: `
      <p style="margin:0 0 12px;">Merci de ton inscription. Confirme ton adresse e-mail pour activer ton compte
      (le lien est valable 24h) :</p>
    `,
    ctaLabel: 'Confirmer mon e-mail',
    footerNote: (link) => `Si tu n'es pas à l'origine de cette inscription, ignore simplement cet e-mail.
      Le lien ne fonctionne pas ? Copie-colle celui-ci : <a href="${link}" style="color:#7893CC;">${link}</a>`,
    subject: 'Confirme ton adresse e-mail - SnipeIT',
    text: (link) => `Bienvenue sur SnipeIT !\n\nConfirme ton adresse e-mail en cliquant sur ce lien (valable 24h) :\n${link}\n\nSi tu n'es pas à l'origine de cette inscription, ignore cet e-mail.`,
  },
  en: {
    preheader: 'Confirm your email address to activate your SnipeIT account.',
    title: 'Welcome to SnipeIT!',
    bodyHtml: `
      <p style="margin:0 0 12px;">Thanks for signing up. Confirm your email address to activate your account
      (this link is valid for 24h):</p>
    `,
    ctaLabel: 'Confirm my email',
    footerNote: (link) => `If you didn't request this sign-up, just ignore this email.
      Link not working? Copy and paste this one instead: <a href="${link}" style="color:#7893CC;">${link}</a>`,
    subject: 'Confirm your email address - SnipeIT',
    text: (link) => `Welcome to SnipeIT!\n\nConfirm your email address by clicking this link (valid for 24h):\n${link}\n\nIf you didn't request this sign-up, just ignore this email.`,
  },
}

async function sendVerificationEmail(to, token, lang = 'en') {
  const baseUrl = process.env.APP_URL || 'https://localhost:4000'
  const link = `${baseUrl}/verify-email.html?token=${token}`
  const s = EMAIL_STRINGS[lang] || EMAIL_STRINGS.fr

  const html = renderEmail({
    preheader: s.preheader,
    title: s.title,
    bodyHtml: s.bodyHtml,
    cta: { label: s.ctaLabel, url: link },
    footerNote: s.footerNote(link),
  }, baseUrl, lang)

  const { data, error } = await getClient().emails.send({
    from: process.env.MAIL_FROM || 'SnipeIT <no-reply@snipeit.local>',
    to,
    subject: s.subject,
    text: s.text(link),
    html,
    tags: [{ name: 'category', value: 'verification' }],
  })

  if (error) {
    throw new Error(`Resend failed to send verification email: ${error.message || error.name || 'unknown error'}`)
  }

  return data
}

module.exports = { sendVerificationEmail }