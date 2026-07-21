/**
 * LangToggle — quick language switcher (EN ⇄ VI).
 */
import { Globe } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LangToggle() {
  const { lang, toggleLang } = useI18n();

  return (
    <button
      className="btn-ghost text-[11px] gap-1"
      onClick={toggleLang}
      title={lang === "en" ? "Chuyển sang Tiếng Việt" : "Switch to English"}
    >
      <Globe size={13} />
      <span className={cn("uppercase", lang === "vi" && "text-accent")}>
        {lang}
      </span>
    </button>
  );
}
