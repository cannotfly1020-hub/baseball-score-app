"use client";

import { BarChart3, Camera, History, Home } from "lucide-react";
import type { TabId } from "@/lib/types";

const ITEMS: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: "home", label: "ホーム", icon: Home },
  { id: "scan", label: "AI読取", icon: Camera },
  { id: "stats", label: "成績", icon: BarChart3 },
  { id: "history", label: "履歴", icon: History },
];

export function BottomNav({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="メインナビ">
      {ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={`nav-btn${isActive ? " active" : ""}`}
            onClick={() => onChange(item.id)}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
