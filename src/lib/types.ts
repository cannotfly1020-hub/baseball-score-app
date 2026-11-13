export const RESULT_OPTIONS = [
  "単打",
  "二塁打",
  "三塁打",
  "本塁打",
  "四球",
  "死球",
  "三振",
  "凡打",
  "犠打",
  "犠飛",
  "敵失",
  "野選",
  "振り逃げ",
  "要確認",
  "なし",
] as const;

export type ResultLabel = (typeof RESULT_OPTIONS)[number];

export type MatchType = "公式戦" | "練習試合" | "紅白戦";

export type TabId = "home" | "scan" | "stats" | "history";

export interface RosterPlayer {
  id: string;
  uniform_number: string;
  player_name: string;
  note: string;
}

export type InningKey = "1" | "2" | "3" | "4" | "5" | "6" | "7";

export type InningsMap = Record<InningKey, ResultLabel>;

/** 打球方向（表示用短縮ラベルに使用） */
export type HitDirection = "" | "投" | "捕" | "一" | "二" | "三" | "遊" | "左" | "中" | "右";

export type OutKind = "" | "ゴロ" | "フライ" | "ライナー";
export type StrikeoutKind = "" | "空" | "見";

/** 打席マスの付加情報（得点●・打点・方向など） */
export interface AtBatCellMeta {
  scored?: boolean;
  rbi?: number;
  direction?: HitDirection;
  outKind?: OutKind;
  strikeoutKind?: StrikeoutKind;
}

export type CellMetaMap = Partial<Record<InningKey, AtBatCellMeta>>;

export interface PlayerAtBat {
  batting_order: number;
  uniform_number: string;
  player_name: string;
  is_substitute: boolean;
  /** 守備位置（任意・表示用） */
  position?: string;
  rbi: number;
  stolen_bases: number;
  innings: InningsMap;
  cellMeta?: CellMetaMap;
  highlight: string;
}

export interface MatchRecord {
  id: string;
  match_date: string;
  opponent: string;
  match_type: MatchType;
  category: string;
  our_score: number;
  their_score: number;
  result: "勝" | "敗" | "分";
  players: PlayerAtBat[];
  created_at: string;
  notes?: string;
}

export interface AppSettings {
  geminiApiKey: string;
  teamName: string;
  aiConsentAccepted: boolean;
}

export interface AppData {
  version: number;
  settings: AppSettings;
  roster: RosterPlayer[];
  matches: MatchRecord[];
}

export interface PlayerStats {
  player_name: string;
  uniform_numbers: string[];
  games: number;
  plate_appearances: number;
  at_bats: number;
  singles: number;
  doubles: number;
  triples: number;
  homeruns: number;
  hits: number;
  total_bases: number;
  walks: number;
  deadballs: number;
  strikeouts: number;
  sacrifice_hits: number;
  sacrifice_flies: number;
  rbi: number;
  stolen_bases: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  avgDisplay: string;
  obpDisplay: string;
  slgDisplay: string;
  opsDisplay: string;
  awards: string[];
}

export interface AnalyzeRequestBody {
  colorImageBase64: string;
  redImageBase64: string;
  /** 必要時のみ: 上下2分割（原本） */
  colorTopImageBase64?: string;
  colorBottomImageBase64?: string;
  /** 必要時のみ: 上下2分割（赤強調） */
  redTopImageBase64?: string;
  redBottomImageBase64?: string;
  mimeType?: string;
  apiKey?: string;
  roster: RosterPlayer[];
  matchMeta?: {
    match_date?: string;
    opponent?: string;
  };
}

export interface AnalyzeResponse {
  players: PlayerAtBat[];
  match_date?: string;
  opponent?: string;
  raw?: {
    step1?: unknown;
    step2?: unknown;
  };
}
