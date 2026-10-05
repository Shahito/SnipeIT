// Convert VAPID key base64 string to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Request permission and register subscription
async function enablePushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications are not supported by this browser.');
    return;
  }

  try {
    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Push notification permission denied.');
      return;
    }

    // Fetch public key
    const keyRes = await fetch('/api/push/vapid-public-key');
    const { publicKey } = await keyRes.json();

    // Get active Service Worker
    const registration = await navigator.serviceWorker.ready;

    // Subscribe to push manager
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    // Send subscription to backend
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription),
    });

    if (res.ok) {
      console.log('Successfully subscribed to push notifications.');
    }
  } catch (error) {
    console.error('Push subscription failed:', error);
  }
}

document.addEventListener('click', function triggerPush() {
  if (Notification.permission === 'default') {
    enablePushNotifications();
  }
  document.removeEventListener('click', triggerPush);
}, { once: true });