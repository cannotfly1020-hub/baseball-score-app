"use client";

import { createId } from "./constants";
import type { AppData, AppSettings, MatchRecord, RosterPlayer } from "./types";
import { STORAGE_KEY } from "./constants";
import defaultRoster from "@/data/default-roster.json";

export function defaultSettings(): AppSettings {
  return {
    geminiApiKey: "",
    teamName: "学童野球チーム",
    aiConsentAccepted: false,
  };
}

export function createDefaultData(): AppData {
  const roster: RosterPlayer[] = (defaultRoster as Omit<RosterPlayer, "id">[]).map((r) => ({
    ...r,
    id: createId("roster"),
  }));
  return {
    version: 1,
    settings: defaultSettings(),
    roster,
    matches: [],
  };
}

export function loadAppData(): AppData {
  if (typeof window === "undefined") return createDefaultData();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const data = createDefaultData();
      saveAppData(data);
      return data;
    }
    const parsed = JSON.parse(raw) as AppData;
    return {
      ...createDefaultData(),
      ...parsed,
      settings: { ...defaultSettings(), ...parsed.settings },
      roster: parsed.roster ?? [],
      matches: parsed.matches ?? [],
    };
  } catch {
    return createDefaultData();
  }
}

export function saveAppData(data: AppData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function exportJsonBackup(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scorebook-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importJsonBackup(file: File): Promise<AppData> {
  const text = await file.text();
  const parsed = JSON.parse(text) as AppData;
  if (!parsed || typeof parsed !== "object") throw new Error("不正なバックアップファイルです");
  const data: AppData = {
    version: 1,
    settings: { ...defaultSettings(), ...parsed.settings },
    roster: Array.isArray(parsed.roster) ? parsed.roster : [],
    matches: Array.isArray(parsed.matches) ? parsed.matches : [],
  };
  saveAppData(data);
  return data;
}

export function upsertMatch(data: AppData, match: MatchRecord): AppData {
  const idx = data.matches.findIndex((m) => m.id === match.id);
  const matches = [...data.matches];
  if (idx >= 0) matches[idx] = match;
  else matches.unshift(match);
  const next = { ...data, matches };
  saveAppData(next);
  return next;
}

export function deleteMatch(data: AppData, matchId: string): AppData {
  const next = { ...data, matches: data.matches.filter((m) => m.id !== matchId) };
  saveAppData(next);
  return next;
}
