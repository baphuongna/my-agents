/**
 * Shared i18n types — kept separate from the React provider so that the
 * per-locale translation modules can import the shape without pulling in a
 * runtime cycle (the provider imports the locales, the locales only import
 * this type module).
 */

/** Supported language codes. */
export type Lang = "en" | "vi" | "zh" | "ja" | "ko" | "es" | "fr" | "de";

/** Display metadata for the language picker (endonyms avoid flag politics). */
export interface LocaleMeta {
  /** English name of the language. */
  name: string;
  /** Native name as written in the language itself. */
  endonym: string;
}

/**
 * Flat translation dictionary. mya keeps its own short, flat key structure
 * (nav labels + common verbs) rather than adopting deeply-nested foreign
 * schemas — the dashboard has different pages/features than its inspiration.
 */
export interface Translations {
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

/** Type guard for a persisted language code. */
export function isLang(value: unknown): value is Lang {
  return (
    value === "en" ||
    value === "vi" ||
    value === "zh" ||
    value === "ja" ||
    value === "ko" ||
    value === "es" ||
    value === "fr" ||
    value === "de"
  );
}
