import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/design-system";
import { openCookieSettings } from "@/components/CookieConsentBanner";
import { loadConsent } from "@/lib/consent/manager";
import { SEO } from "@/components/SEO";
import { usePolicy } from "@/hooks/usePolicy";

interface InspectorRow {
  name: string;
  category: string;
  source: "cookie" | "localStorage";
  value: string;
  setBy?: string;
}

const KEY_INDEX: Record<string, { category: string }> = {
  "tfn.consent.v1": { category: "Strictly necessary" },
  "tfn.anon_id.v1": { category: "Strictly necessary" },
  "tfn.policy_ack": { category: "Strictly necessary" },
  tf_theme: { category: "Functional" },
  tf_locale: { category: "Functional" },
  tf_dashboard_layout: { category: "Functional" },
};

const EXTENSION_PATTERNS = [
  /^ethereum-/i,
  /^binance-/i,
  /-walletlink$/i,
  /^__REACT_DEVTOOLS_/,
  /^phantom-/i,
  /^brave-/i,
  /^wallet_/i,
  /^wc@/i,
  /^trustwallet-/i,
  /^coinbase-/i,
  /^rabby-/i,
  /^rainbow-/i,
  /^argent-/i,
  /^exodus-/i,
  /^enkrypt-/i,
  /^taho-/i,
  /^__metamask/,
  /^_wc@/,
];

function isBrowserExtensionKey(name: string): boolean {
  return EXTENSION_PATTERNS.some((p) => p.test(name));
}

function getCategory(name: string): { category: string; setBy?: string } {
  const known = KEY_INDEX[name];
  if (known) return known;
  if (name.startsWith("_ga") || name.startsWith("_clck")) return { category: "Analytics" };
  if (name.startsWith("tf") || name.startsWith("tfn")) return { category: "Functional" };
  if (isBrowserExtensionKey(name))
    return { category: "Browser extension", setBy: "Your browser extension (not Tech Fleet)" };
  return { category: "Other" };
}

function inspect(): InspectorRow[] {
  const rows: InspectorRow[] = [];
  if (typeof document !== "undefined") {
    document.cookie
      .split(";")
      .map((c) => c.trim())
      .filter(Boolean)
      .forEach((c) => {
        const [name, ...rest] = c.split("=");
        const meta = getCategory(name);
        rows.push({
          name,
          category: meta.category,
          source: "cookie",
          value: rest.join("=").slice(0, 32),
          setBy: meta.setBy,
        });
      });
  }
  if (typeof localStorage !== "undefined") {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const meta = getCategory(k);
      rows.push({
        name: k,
        category: meta.category,
        source: "localStorage",
        value: (localStorage.getItem(k) || "").slice(0, 32),
        setBy: meta.setBy,
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export default function CookiesPage() {
  const { data: policy } = usePolicy("cookies");
  const md = policy?.body_md ?? "";
  const [rows, setRows] = useState<InspectorRow[]>([]);
  const consent = useMemo(() => loadConsent(), []);

  useEffect(() => {
    setRows(inspect());
  }, []);

  return (
    <div className="container-app py-8 space-y-8">
      <SEO
        title="Cookie Policy"
        description="Learn about how Tech Fleet uses cookies and manage your consent preferences."
        canonicalPath="/cookies"
      />
      <header>
        <h1 className="text-2xl font-bold">Cookie Policy</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Effective May 7, 2026 ·{" "}
          <Button variant="link" className="px-0 h-auto" onClick={() => openCookieSettings()}>
            Open Cookie Settings
          </Button>
        </p>
      </header>

      <section aria-labelledby="inspector" className="rounded-md border bg-card p-4 sm:p-6">
        <h2 id="inspector" className="text-lg font-semibold">
          What's stored on this device
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Live inspector of cookies and localStorage entries set by this site in your current
          browser. Entries marked <em>Browser extension</em> come from add-ons you have installed
          (for example, a crypto wallet or developer tool) and are not set by Tech Fleet. Your
          current consent:{" "}
          {consent ? (
            <code>{`functional=${consent.functional} analytics=${consent.analytics} marketing=${consent.marketing} gpc=${consent.gpc}`}</code>
          ) : (
            "no decision yet"
          )}
          .
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Name</th>
                <th className="py-1 pr-3">Category</th>
                <th className="py-1 pr-3">Source</th>
                <th className="py-1 pr-3">Set by</th>
                <th className="py-1">Value (truncated)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-2 text-muted-foreground">
                    Nothing stored yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={`${r.source}:${r.name}`} className="border-t">
                  <td className="py-1 pr-3 font-mono">{r.name}</td>
                  <td className="py-1 pr-3">{r.category}</td>
                  <td className="py-1 pr-3">{r.source}</td>
                  <td className="py-1 pr-3 text-muted-foreground">{r.setBy ?? "Tech Fleet"}</td>
                  <td className="py-1 font-mono text-muted-foreground truncate max-w-[20ch]">
                    {r.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        aria-labelledby="policy-text"
        className="prose prose-sm dark:prose-invert max-w-none"
      >
        <h2 id="policy-text" className="sr-only">
          Full Cookie Policy
        </h2>
        <ReactMarkdown>{md}</ReactMarkdown>
      </section>
    </div>
  );
}
