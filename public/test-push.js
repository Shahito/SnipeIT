const btn = document.getElementById('send-btn')
const log = document.getElementById('log')

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

btn.addEventListener('click', async () => {
    console.log('click')
  log.innerText = '1/2 Sync de l\'abonnement...'

  try {
    // 1. Récupérer la clé VAPID et synchroniser la souscription actuelle
    const keyRes = await fetch('/api/push/vapid-public-key')
    const { publicKey } = await keyRes.json()

    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    })

    log.innerText = '2/2 Envoi du Push...'

    // 2. Déclencher l'envoi
    const res = await fetch('/api/push/send-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Hello ! 👋',
        body: 'Notification de test reçue avec succès !',
        url: '/',
      }),
    })

    const data = await res.json()

    if (res.ok) {
      log.innerText = `Envoyé à ${data.count} appareil(s) !`
    } else {
      log.innerText = `Erreur API: ${JSON.stringify(data)}`
    }
  } catch (err) {
    log.innerText = `Erreur: ${err.message}`
    console.error(err)
  }
})