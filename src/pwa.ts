/** Registers the offline cache in production builds and asks it to keep the current assets. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        // Assets loaded before the worker took control are not cached yet, so hand them over.
        const urls = [
          window.location.href,
          ...performance.getEntriesByType('resource').map((entry) => entry.name),
        ];
        registration.active?.postMessage({ type: 'cache-urls', urls });
      })
      .catch((error: unknown) => {
        console.warn('Offline support is unavailable:', error);
      });
  });
}
