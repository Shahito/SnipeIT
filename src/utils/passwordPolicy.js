const MIN_LENGTH = 8
const MAX_LENGTH = 72 // bcrypt truncates/errors past 72 bytes

const RULES = {
  length: (pw) => pw.length >= MIN_LENGTH && pw.length <= MAX_LENGTH,
  lowercase: (pw) => /[a-z]/.test(pw),
  uppercase: (pw) => /[A-Z]/.test(pw),
  digit: (pw) => /\d/.test(pw),
  special: (pw) => /[^A-Za-z0-9]/.test(pw),
}

function evaluatePassword(password, context = {}) {
  const pw = password || ''
  const checks = {}
  for (const [name, test] of Object.entries(RULES)) checks[name] = test(pw)

  return { valid: Object.values(checks).every(Boolean), checks }
}

module.exports = { evaluatePassword, MIN_LENGTH, MAX_LENGTH }