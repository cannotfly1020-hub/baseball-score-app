"use client";

import { Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BottomNav } from "@/components/BottomNav";
import { ConsentModal } from "@/components/ConsentModal";
import { SettingsModal } from "@/components/SettingsModal";
import { RosterManager } from "@/components/roster/RosterManager";
import { HistoryTab } from "@/components/tabs/HistoryTab";
import { HomeTab } from "@/components/tabs/HomeTab";
import { ScanTab } from "@/components/tabs/ScanTab";
import { StatsTab } from "@/components/tabs/StatsTab";
import { deleteMatch, loadAppData, saveAppData, upsertMatch } from "@/lib/storage";
import type { AppData, AppSettings, MatchRecord, TabId } from "@/lib/types";

export function AppShell() {
  const [data, setData] = useState<AppData | null>(null);
  const [tab, setTab] = useState<TabId>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const consentResolver = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    setData(loadAppData());
  }, []);

  const persist = useCallback((next: AppData) => {
    setData(next);
    saveAppData(next);
  }, []);

  const requestConsent = useCallback((): Promise<boolean> => {
    if (data?.settings.aiConsentAccepted) return Promise.resolve(true);
    setConsentOpen(true);
    return new Promise((resolve) => {
      consentResolver.current = resolve;
    });
  }, [data?.settings.aiConsentAccepted]);

  if (!data) {
    return (
      <div className="app-shell">
        <div className="app-frame" style={{ display: "grid", placeItems: "center" }}>
          <p className="muted">読み込み中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-frame">
        <header className="app-header">
          <div className="brand-mark">
            <span className="brand-dot" aria-hidden />
            <div>
              <div className="brand-title">SCOREBOOK AI</div>
              <div style={{ fontSize: "0.68rem", opacity: 0.75 }}>{data.settings.teamName}</div>
            </div>
          </div>
          <button
            type="button"
            aria-label="設定"
            onClick={() => setSettingsOpen(true)}
            style={{
              border: 0,
              background: "rgba(255,255,255,0.08)",
              color: "white",
              borderRadius: 10,
              width: 40,
              height: 40,
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <Settings size={18} />
          </button>
        </header>

        <main className="app-main">
          {tab === "home" ? <HomeTab data={data} /> : null}
          {tab === "scan" ? (
            <ScanTab
              data={data}
              consentAccepted={data.settings.aiConsentAccepted}
              onRequestConsent={requestConsent}
              onSaveMatch={(match: MatchRecord) => persist(upsertMatch(data, match))}
            />
          ) : null}
          {tab === "stats" ? <StatsTab data={data} /> : null}
          {tab === "history" ? (
            <HistoryTab
              data={data}
              onDelete={(id) => persist(deleteMatch(data, id))}
              onOpenRoster={() => setRosterOpen(true)}
            />
          ) : null}
        </main>

        <BottomNav active={tab} onChange={setTab} />
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={data.settings}
        data={data}
        onClose={() => setSettingsOpen(false)}
        onSave={(settings: AppSettings) => persist({ ...data, settings })}
        onImported={(imported) => setData(imported)}
      />

      {rosterOpen ? (
        <RosterManager
          roster={data.roster}
          onChange={(roster) => persist({ ...data, roster })}
          onClose={() => setRosterOpen(false)}
        />
      ) : null}

      <ConsentModal
        open={consentOpen}
        onCancel={() => {
          setConsentOpen(false);
          consentResolver.current?.(false);
          consentResolver.current = null;
        }}
        onAccept={() => {
          const next = {
            ...data,
            settings: { ...data.settings, aiConsentAccepted: true },
          };
          persist(next);
          setConsentOpen(false);
          consentResolver.current?.(true);
          consentResolver.current = null;
        }}
      />
    </div>
  );
}
