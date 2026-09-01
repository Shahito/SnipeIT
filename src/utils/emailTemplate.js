const COLORS = {
  bg: '#F7F6F2',
  card: '#0E0F14',
  border: 'rgba(112, 120, 138, 0.16)',
  primary: '#7893CC',
  primaryHover: '#5E7AB8',
  text: '#F2F3F6',
  textMuted: '#979CA6',
}

function button(label, url) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 8px;">
      <tr>
        <td align="center" bgcolor="${COLORS.primary}" style="border-radius:8px;">
          <a href="${url}" target="_blank"
             style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;
                    color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`
}

function renderEmail({ preheader = '', title, bodyHtml, cta = null, footerNote = '' }, appUrl) {
  const logoUrl = `${appUrl}/images/icons/192.png`

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.bg};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0"
               style="max-width:480px;width:100%;background-color:${COLORS.card};
                      border:1px solid ${COLORS.border};border-radius:14px;overflow:hidden;
                      font-family:Arial,Helvetica,sans-serif;">
          <tr>
            <td align="center" style="padding:32px 32px 8px;">
              <img src="${logoUrl}" width="48" height="48" alt="SnipeIT"
                   style="display:block;border-radius:10px;">
              <div style="margin-top:10px;font-size:17px;font-weight:700;letter-spacing:.02em;">
                <span style="color:${COLORS.text};">Snipe</span><span style="color:${COLORS.primary};">IT</span>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 4px;">
              <h1 style="margin:16px 0 0;font-size:19px;font-weight:600;color:${COLORS.text};text-align:center;">
                ${title}
              </h1>
            </td>
          </tr>

          <tr>
            <td style="padding:12px 32px 4px;font-size:14px;line-height:1.6;color:${COLORS.textMuted};">
              ${bodyHtml}
            </td>
          </tr>

          ${cta ? `<tr><td style="padding:0 32px;">${button(cta.label, cta.url)}</td></tr>` : ''}

          <tr>
            <td style="padding:24px 32px 32px;">
              <hr style="border:none;border-top:1px solid ${COLORS.border};margin:0 0 16px;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${COLORS.textMuted};text-align:center;">
                ${footerNote}
              </p>
            </td>
          </tr>
        </table>

        <p style="margin:20px 0 0;font-size:11px;color:${COLORS.textMuted};font-family:Arial,Helvetica,sans-serif;">
          SnipeIT
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

module.exports = { renderEmail }