/**
 * @my-agent/web/pwa-register — Service Worker registration + update prompt.
 *
 * Registers /sw.js, listens for updates, and shows a reload prompt when
 * a new version is activated.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            // New version available — prompt reload
            if (confirm("mya updated. Reload to activate?")) {
              window.location.reload();
            }
          }
        });
      });
    }).catch(() => {
      // SW registration failed — PWA features unavailable, app still works
    });
  });
}
