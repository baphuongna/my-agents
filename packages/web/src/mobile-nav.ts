/**
 * @my-agent/web/mobile-nav — Bottom tab bar + responsive mobile navigation.
 *
 * Renders a thumb-friendly bottom nav (Sessions | Chat | Settings) on mobile,
 * with safe-area inset support + haptic feedback on touch.
 */
export interface MobileNavOptions {
  onTabChange?: (tab: string) => void;
}

/** Render the bottom nav HTML. */
export function renderMobileNav(opts: MobileNavOptions = {}): string {
  return `
<nav class="mobile-nav" id="mobile-nav" style="
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 1000;
  display: flex; justify-content: space-around; align-items: center;
  background: var(--bg-secondary, #1a1a2e); border-top: 1px solid var(--border, #333);
  padding: 8px 0 env(safe-area-inset-bottom, 0px);
  font-size: 11px; user-select: none;
">
  <button class="nav-tab" data-tab="sessions" style="flex:1;background:none;border:none;color:var(--text,#eee);padding:8px;cursor:pointer;">
    <div style="font-size:20px;">💬</div>Sessions
  </button>
  <button class="nav-tab" data-tab="chat" style="flex:1;background:none;border:none;color:var(--text,#eee);padding:8px;cursor:pointer;">
    <div style="font-size:20px;">✏️</div>Chat
  </button>
  <button class="nav-tab" data-tab="settings" style="flex:1;background:none;border:none;color:var(--text,#eee);padding:8px;cursor:pointer;">
    <div style="font-size:20px;">⚙️</div>Settings
  </button>
</nav>`;
}

/** Wire up tab click handlers with haptic feedback. */
export function initMobileNav(opts: MobileNavOptions = {}): void {
  const nav = document.getElementById("mobile-nav");
  if (!nav) return;
  const tabs = nav.querySelectorAll<HTMLButtonElement>(".nav-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      // Haptic feedback (if supported)
      if ("vibrate" in navigator) navigator.vibrate(10);
      // Active state
      tabs.forEach((t) => t.style.opacity = "0.6");
      tab.style.opacity = "1";
      const tabName = tab.dataset.tab ?? "";
      opts.onTabChange?.(tabName);
    });
  });
}

/** Detect mobile viewport. */
export function isMobile(): boolean {
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
