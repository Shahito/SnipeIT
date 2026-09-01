const PasswordPolicy = (() => {
  const MIN_LENGTH = 8
  const MAX_LENGTH = 72

  function evaluate(password, context = {}) {
    const pw = password || ''
    const checks = [
      { id: 'length', ok: pw.length >= MIN_LENGTH && pw.length <= MAX_LENGTH },
      { id: 'lowercase', ok: /[a-z]/.test(pw) },
      { id: 'uppercase', ok: /[A-Z]/.test(pw) },
      { id: 'digit', ok: /\d/.test(pw) },
      { id: 'special', ok: /[^A-Za-z0-9]/.test(pw) },
    ]
    return { valid: checks.every(c => c.ok), checks }
  }

  return { evaluate, MIN_LENGTH, MAX_LENGTH }
})()