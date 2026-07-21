/**
 * i18n system — lightweight context-based internationalization.
 * Supports: English (en), Vietnamese (vi).
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

type Lang = "en" | "vi";

interface Translations {
  // Nav
  chat: string;
  sessions: string;
  events: string;
  cron: string;
  models: string;
  tools: string;
  files: string;
  analytics: string;
  logs: string;
  channels: string;
  mcp: string;
  skills: string;
  sync: string;
  keys: string;
  config: string;
  system: string;
  push: string;
  collab: string;
  // Common
  save: string;
  cancel: string;
  delete: string;
  refresh: string;
  loading: string;
  search: string;
  create: string;
  confirm: string;
  close: string;
  enable: string;
  disable: string;
  test: string;
  // Sections
  main: string;
  configuration: string;
  // Status
  online: string;
  offline: string;
  connecting: string;
  running: string;
  // Misc
  noResults: string;
  of: string;
}

const EN: Translations = {
  chat: "Chat",
  sessions: "Sessions",
  events: "Live Events",
  cron: "Cron",
  models: "Models",
  tools: "Tools",
  files: "Files",
  analytics: "Analytics",
  logs: "Logs",
  channels: "Channels",
  mcp: "MCP",
  skills: "Skills",
  sync: "Sync",
  keys: "API Keys",
  config: "Config",
  system: "System",
  push: "Push",
  collab: "Collaboration",
  save: "Save",
  cancel: "Cancel",
  delete: "Delete",
  refresh: "Refresh",
  loading: "Loading…",
  search: "Search…",
  create: "Create",
  confirm: "Confirm",
  close: "Close",
  enable: "Enable",
  disable: "Disable",
  test: "Test",
  main: "Main",
  configuration: "Configuration",
  online: "online",
  offline: "offline",
  connecting: "connecting",
  running: "running",
  noResults: "No results",
  of: "of",
};

const VI: Translations = {
  chat: "Trò chuyện",
  sessions: "Phiên",
  events: "Sự kiện trực tiếp",
  cron: "Cron",
  models: "Mô hình",
  tools: "Công cụ",
  files: "Tệp",
  analytics: "Phân tích",
  logs: "Nhật ký",
  channels: "Kênh",
  mcp: "MCP",
  skills: "Kỹ năng",
  sync: "Đồng bộ",
  keys: "API Keys",
  config: "Cấu hình",
  system: "Hệ thống",
  push: "Thông báo",
  collab: "Hợp tác",
  save: "Lưu",
  cancel: "Hủy",
  delete: "Xóa",
  refresh: "Làm mới",
  loading: "Đang tải…",
  search: "Tìm kiếm…",
  create: "Tạo",
  confirm: "Xác nhận",
  close: "Đóng",
  enable: "Bật",
  disable: "Tắt",
  test: "Thử",
  main: "Chính",
  configuration: "Cấu hình",
  online: "trực tuyến",
  offline: "ngoại tuyến",
  connecting: "đang kết nối",
  running: "đang chạy",
  noResults: "Không có kết quả",
  of: "trên",
};

const TRANSLATIONS: Record<Lang, Translations> = { en: EN, vi: VI };
const LANG_KEY = "mya-lang";

interface I18nContextValue {
  lang: Lang;
  t: Translations;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(LANG_KEY) as Lang | null;
    return stored ?? "en";
  });

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next = prev === "en" ? "vi" : "en";
      localStorage.setItem(LANG_KEY, next);
      return next;
    });
  }, []);

  return (
    <I18nContext.Provider value={{ lang, t: TRANSLATIONS[lang], setLang, toggleLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
