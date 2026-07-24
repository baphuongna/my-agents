/**
 * DocsPage — embedded documentation via iframe.
 * Port of Hermes DocsPage (69 lines). Hermes points at its own docs site;
 * mya has no hosted docs yet, so we link to the project README.
 */
import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/PageBits";
import { BookOpen } from "lucide-react";

export const MYA_DOCS_URL = "https://github.com/baphuongna/my-agents#readme";

export function DocsPage() {
  return (
    <div className="flex flex-col h-full p-4 gap-3 animate-fade-in-up">
      <PageHeader
        title="Documentation"
        icon={BookOpen}
        actions={
          <a
            href={MYA_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <ExternalLink size={13} />
            Open in new tab
          </a>
        }
      />

      <iframe
        title="mya documentation"
        src={MYA_DOCS_URL}
        className="min-h-0 w-full flex-1 rounded-xl border border-border/50 bg-white"
        // Docusaurus / GitHub docs paint over a transparent body and rely on the
        // browser canvas (light by default). Forcing a light color scheme + white
        // background keeps the docs readable regardless of the dashboard theme.
        style={{ colorScheme: "light" }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
