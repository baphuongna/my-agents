// @vitest-environment happy-dom
/**
 * LanguageSwitcher component tests (DOM via happy-dom).
 *
 * Covers: renders the current endonym, opens the dropdown with all 8 locales,
 * selecting a locale switches + persists + closes, Escape dismisses, and
 * click-outside dismisses.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@/lib/i18n";
import { LOCALES, LOCALE_META } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

// React 19 act environment flag — ensures act flushes synchronously.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function render(ui: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

function trigger(container: HTMLElement): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(
    '[data-testid="language-switcher-trigger"]',
  );
  if (!el) throw new Error("trigger not found");
  return el;
}

function openDropdown(container: HTMLElement) {
  act(() => {
    trigger(container).click();
  });
}

function options(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));
}

function optionByEndonym(container: HTMLElement, endonym: string): HTMLElement {
  const opt = options(container).find((o) => o.textContent?.includes(endonym));
  if (!opt) throw new Error(`option "${endonym}" not found`);
  return opt;
}

describe("[smoke] LanguageSwitcher", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders the current locale endonym on the trigger", () => {
    ({ container, root } = render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    ));
    // default lang is "en"
    expect(trigger(container).textContent).toContain(LOCALE_META.en.endonym);
  });

  it("opens the dropdown listing all 8 locales on click", () => {
    ({ container, root } = render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    ));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    openDropdown(container);

    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(options(container)).toHaveLength(8);

    // every locale endonym is present
    for (const code of LOCALES) {
      expect(optionByEndonym(container, LOCALE_META[code].endonym)).toBeTruthy();
    }

    // the active locale is marked selected
    const selected = container.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    expect(selected?.textContent).toContain(LOCALE_META.en.endonym);
  });

  it("selecting a locale switches language, persists, and closes", () => {
    ({ container, root } = render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    ));
    openDropdown(container);
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    act(() => {
      optionByEndonym(container, LOCALE_META.vi.endonym).click();
    });

    // dropdown closed
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    // trigger now shows the new endonym
    expect(trigger(container).textContent).toContain(LOCALE_META.vi.endonym);
    // persisted to localStorage
    expect(localStorage.getItem("mya-lang")).toBe("vi");
  });

  it("dismisses on Escape", () => {
    ({ container, root } = render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    ));
    openDropdown(container);
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("dismisses on click-outside", () => {
    ({ container, root } = render(
      <I18nProvider>
        <LanguageSwitcher />
      </I18nProvider>,
    ));
    openDropdown(container);
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    // an element outside both the trigger and the dropdown
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    act(() => {
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("collapsed mode renders only the globe (no endonym label)", () => {
    ({ container, root } = render(
      <I18nProvider>
        <LanguageSwitcher collapsed />
      </I18nProvider>,
    ));
    const t = trigger(container);
    // trigger still has a title for accessibility, but no visible endonym text
    expect(t.textContent).not.toContain(LOCALE_META.en.endonym);
  });

  it("dropUp mode portals the dropdown to document.body", () => {
    ({ container, root } = render(
      <I18nProvider>
        <LanguageSwitcher dropUp />
      </I18nProvider>,
    ));
    openDropdown(container);
    // listbox is portaled to body, not inside the render container
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[role="option"]')).toHaveLength(8);
  });
});
