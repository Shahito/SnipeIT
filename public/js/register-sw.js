if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.error('[SnipeIT] SW registration failed:', err);
  });
}