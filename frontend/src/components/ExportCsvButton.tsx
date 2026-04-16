import { Loader2 } from "lucide-react";
import { useState } from "react";
import { apiUrl, AUTH_TOKEN_STORAGE_KEY } from "../lib/auth-api.js";

type ExportCsvButtonProps = {
  endpoint?: string;
  url?: string;
  filename: string;
  label: string;
};

function readDownloadName(header: string | null, fallback: string): string {
  if (header === null) {
    return fallback;
  }
  const match = /filename="([^"]+)"/i.exec(header);
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : fallback;
}

export function ExportCsvButton({ endpoint, url, filename, label }: ExportCsvButtonProps) {
  const [loading, setLoading] = useState(false);

  const target = endpoint ?? url;

  return (
    <button
      type="button"
      disabled={loading || target === undefined || target.length === 0}
      onClick={() => {
        if (target === undefined || target.length === 0) {
          window.alert("Brak endpointu eksportu CSV.");
          return;
        }
        const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
        if (token === null || token.length === 0) {
          window.alert("Brak aktywnej sesji.");
          return;
        }

        void (async () => {
          setLoading(true);
          try {
            const res = await fetch(apiUrl(target), {
              method: "GET",
              credentials: "include",
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "text/csv",
              },
            });
            if (!res.ok) {
              const errText = await res.text();
              throw new Error(errText.length > 0 ? errText : `Błąd eksportu CSV (${res.status})`);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = readDownloadName(res.headers.get("content-disposition"), filename);
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(objectUrl);
          } catch (err) {
            window.alert(err instanceof Error ? err.message : "Nie udało się wyeksportować CSV.");
          } finally {
            setLoading(false);
          }
        })();
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-violet-500/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" /> : null}
      {loading ? "Eksportowanie..." : label}
    </button>
  );
}
