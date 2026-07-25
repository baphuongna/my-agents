// @vitest-environment happy-dom
/**
 * ProfileProvider / useProfileScope — context defaults, provider state,
 * URL sync (?profile=), and ProfileSwitcher hidden-when-<2 behaviour.
 *
 * Uses happy-dom + createRoot/act (matching the language-switcher test
 * pattern). The api module is mocked so no network calls fire.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { ProfileProvider } from "@/contexts/ProfileProvider";
import {
  ProfileContext,
  type ProfileContextValue,
} from "@/contexts/profile-context";
import { useProfileScope } from "@/contexts/useProfileScope";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";

vi.mock("@/lib/api", () => ({
  api: {
    getProfiles: vi.fn(),
    getActiveProfile: vi.fn(),
  },
  setManagementProfile: vi.fn(),
}));

// React 19 act environment flag.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { api } = await import("@/lib/api");

/** Probe that captures useProfileScope() only (no router deps). */
function ScopeOnlyProbe() {
  const scope = useProfileScope();
  return (
    <div>
      <span data-testid="profile">{scope.profile}</span>
      <span data-testid="currentProfile">{scope.currentProfile}</span>
      <span data-testid="profiles">{scope.profiles.join(",")}</span>
      <button
        data-testid="set-acme"
        onClick={() => scope.setProfile("acme")}
      >
        set
      </button>
    </div>
  );
}

/** Probe that captures useProfileScope() + URL search + a nav button. */
function ScopeProbe() {
  const scope = useProfileScope();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="profile">{scope.profile}</span>
      <span data-testid="currentProfile">{scope.currentProfile}</span>
      <span data-testid="profiles">{scope.profiles.join(",")}</span>
      <span data-testid="url-profile">{params.get("profile") ?? ""}</span>
      <button
        data-testid="set-acme"
        onClick={() => scope.setProfile("acme")}
      >
        set acme
      </button>
      <button
        data-testid="set-empty"
        onClick={() => scope.setProfile("")}
      >
        set empty
      </button>
      <button data-testid="nav-config" onClick={() => navigate("/config")}>
        nav config
      </button>
    </div>
  );
}

function text(container: HTMLElement, id: string): string {
  const el = container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`testid "${id}" not found`);
  return el.textContent ?? "";
}

function click(container: HTMLElement, id: string) {
  const el = container.querySelector<HTMLButtonElement>(
    `[data-testid="${id}"]`,
  );
  if (!el) throw new Error(`button "${id}" not found`);
  act(() => {
    el.click();
  });
}

/** Flush the provider's async mount effect (Promise.all). */
function flush(): Promise<void> {
  return act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

/** Wait until the profiles list populates (the real signal the effect ran). */
async function waitForProfiles(
  container: HTMLElement,
  expected: string,
): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await flush();
    if (text(container, "profiles") === expected) return;
  }
  throw new Error(
    `profiles never became "${expected}", got "${text(container, "profiles")}"`,
  );
}

function renderWith(
  ui: React.ReactElement,
  initialEntry = "/",
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>,
    );
  });
  return { container, root };
}

describe("[smoke] ProfileContext default value", () => {
  let container: HTMLDivElement;
  let root: Root;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    document.body.innerHTML = "";
  });

  it("useProfileScope returns defaults when no provider is mounted", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<ScopeOnlyProbe />);
    });
    expect(text(container, "profile")).toBe("");
    expect(text(container, "currentProfile")).toBe("default");
    expect(text(container, "profiles")).toBe("");
    // setProfile is the no-op default; clicking must not throw.
    expect(() => click(container, "set-acme")).not.toThrow();
    expect(text(container, "profile")).toBe("");
  });

  it("exported ProfileContext default matches the interface shape", () => {
    const holder: { value: ProfileContextValue | null } = { value: null };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <ProfileContext.Consumer>
          {(v) => {
            holder.value = v;
            return null;
          }}
        </ProfileContext.Consumer>,
      );
    });
    expect(holder.value).not.toBeNull();
    const c = holder.value!;
    expect(c.profile).toBe("");
    expect(c.currentProfile).toBe("default");
    expect(c.profiles).toEqual([]);
    expect(typeof c.setProfile).toBe("function");
  });
});

describe("[smoke] ProfileProvider state + URL sync", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.mocked(api.getProfiles).mockResolvedValue({
      profiles: [
        { name: "default", is_default: true },
        { name: "work" },
        { name: "personal" },
      ],
    });
    vi.mocked(api.getActiveProfile).mockResolvedValue({ name: "default" });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    document.body.innerHTML = "";
    vi.mocked(api.getProfiles).mockReset();
    vi.mocked(api.getActiveProfile).mockReset();
  });

  it("loads profiles + active profile on mount and aligns scope to active", async () => {
    ({ container, root } = renderWith(
      <ProfileProvider>
        <ScopeProbe />
      </ProfileProvider>,
      "/sessions",
    ));
    await waitForProfiles(container, "default,work,personal");
    expect(text(container, "currentProfile")).toBe("default");
    // no deep link → aligned to active ("default")
    expect(text(container, "profile")).toBe("default");
  });

  it("deep link ?profile= wins over the active profile on mount", async () => {
    ({ container, root } = renderWith(
      <ProfileProvider>
        <ScopeProbe />
      </ProfileProvider>,
      "/skills?profile=work",
    ));
    await waitForProfiles(container, "default,work,personal");
    expect(text(container, "profile")).toBe("work");
    expect(text(container, "url-profile")).toBe("work");
  });

  it("setProfile updates state and writes ?profile= into the URL", async () => {
    ({ container, root } = renderWith(
      <ProfileProvider>
        <ScopeProbe />
      </ProfileProvider>,
      "/sessions",
    ));
    await waitForProfiles(container, "default,work,personal");
    click(container, "set-acme");
    expect(text(container, "profile")).toBe("acme");
    expect(text(container, "url-profile")).toBe("acme");
  });

  it("setProfile(\"\") removes ?profile= from the URL", async () => {
    ({ container, root } = renderWith(
      <ProfileProvider>
        <ScopeProbe />
      </ProfileProvider>,
      "/config?profile=work",
    ));
    await waitForProfiles(container, "default,work,personal");
    click(container, "set-empty");
    expect(text(container, "profile")).toBe("");
    expect(text(container, "url-profile")).toBe("");
  });

  it("re-asserts ?profile= onto a bare navigation (no silent reset)", async () => {
    ({ container, root } = renderWith(
      <ProfileProvider>
        <ScopeProbe />
      </ProfileProvider>,
      "/skills?profile=work",
    ));
    await waitForProfiles(container, "default,work,personal");
    expect(text(container, "profile")).toBe("work");
    // Simulate a bare nav link that drops the param via useNavigate.
    click(container, "nav-config");
    await flush();
    expect(text(container, "url-profile")).toBe("work");
    expect(text(container, "profile")).toBe("work");
  });

  it("survives a failed profiles/active fetch (no crash)", async () => {
    vi.mocked(api.getProfiles).mockRejectedValue(new Error("network"));
    vi.mocked(api.getActiveProfile).mockRejectedValue(new Error("network"));
    ({ container, root } = renderWith(
      <ProfileProvider>
        <ScopeProbe />
      </ProfileProvider>,
      "/sessions",
    ));
    await flush();
    // provider still renders with safe defaults
    expect(text(container, "currentProfile")).toBe("default");
    expect(text(container, "profiles")).toBe("");
  });
});

describe("[smoke] ProfileSwitcher visibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    document.body.innerHTML = "";
    vi.mocked(api.getProfiles).mockReset();
    vi.mocked(api.getActiveProfile).mockReset();
  });

  it("renders nothing when fewer than 2 profiles are known", async () => {
    vi.mocked(api.getProfiles).mockResolvedValue({
      profiles: [{ name: "default" }],
    });
    vi.mocked(api.getActiveProfile).mockResolvedValue({ name: "default" });
    ({ container, root } = renderWith(
      <ProfileProvider>
        <ProfileSwitcher />
      </ProfileProvider>,
    ));
    await flush();
    expect(
      container.querySelector('[data-testid="profile-switcher-select"]'),
    ).toBeNull();
  });

  it("renders the select when 2+ profiles are known", async () => {
    vi.mocked(api.getProfiles).mockResolvedValue({
      profiles: [{ name: "default" }, { name: "work" }],
    });
    vi.mocked(api.getActiveProfile).mockResolvedValue({ name: "default" });
    ({ container, root } = renderWith(
      <ProfileProvider>
        <ProfileSwitcher />
      </ProfileProvider>,
    ));
    // poll for the effect to populate profiles (≥2 → switcher renders)
    for (let i = 0; i < 50; i++) {
      await flush();
      if (container.querySelector('[data-testid="profile-switcher-select"]'))
        break;
    }
    expect(
      container.querySelector('[data-testid="profile-switcher-select"]'),
    ).not.toBeNull();
  });
});
