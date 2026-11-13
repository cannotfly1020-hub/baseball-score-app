import type {
  AtBatCellMeta,
  HitDirection,
  PlayerAtBat,
  ResultLabel,
} from "./types";

export const HIT_DIRECTIONS: HitDirection[] = [
  "投",
  "捕",
  "一",
  "二",
  "三",
  "遊",
  "左",
  "中",
  "右",
];

/** マトリクス表示用の短縮ラベル（例: 右安 / 遊ゴ / 空三） */
export function formatAtBatBadge(
  result: ResultLabel,
  meta?: AtBatCellMeta,
): string {
  const dir = meta?.direction || "";
  switch (result) {
    case "単打":
      return dir ? `${dir}安` : "単打";
    case "二塁打":
      return dir ? `${dir}二` : "二塁";
    case "三塁打":
      return dir ? `${dir}三` : "三塁";
    case "本塁打":
      return dir ? `${dir}本` : "本塁";
    case "凡打": {
      const kind =
        meta?.outKind === "フライ" ? "飛" : meta?.outKind === "ライナー" ? "直" : "ゴ";
      return dir ? `${dir}${kind}` : meta?.outKind === "フライ" ? "フライ" : "ゴロ";
    }
    case "三振":
      return meta?.strikeoutKind === "見" ? "見三" : meta?.strikeoutKind === "空" ? "空三" : "三振";
    case "四球":
      return "四球";
    case "死球":
      return "死球";
    case "犠打":
      return dir ? `${dir}犠` : "犠打";
    case "犠飛":
      return dir ? `${dir}犠飛` : "犠飛";
    case "敵失":
      return dir ? `${dir}失` : "敵失";
    case "野選":
      return "野選";
    case "振り逃げ":
      return "振逃";
    case "要確認":
      return "要確認";
    case "なし":
      return "—";
    default:
      return result;
  }
}

export type BadgeTone =
  | "hit"
  | "extra"
  | "hr"
  | "walk"
  | "out"
  | "k"
  | "sac"
  | "error"
  | "review"
  | "empty"
  | "other";

export function badgeTone(result: ResultLabel): BadgeTone {
  switch (result) {
    case "単打":
      return "hit";
    case "二塁打":
    case "三塁打":
      return "extra";
    case "本塁打":
      return "hr";
    case "四球":
    case "死球":
      return "walk";
    case "凡打":
    case "野選":
      return "out";
    case "三振":
    case "振り逃げ":
      return "k";
    case "犠打":
    case "犠飛":
      return "sac";
    case "敵失":
      return "error";
    case "要確認":
      return "review";
    case "なし":
      return "empty";
    default:
      return "other";
  }
}

export function emptyCellMeta(): AtBatCellMeta {
  return {
    scored: false,
    runMark: "",
    rbi: 0,
    direction: "",
    outKind: "",
    strikeoutKind: "",
  };
}

export function getCellMeta(player: PlayerAtBat, inning: string): AtBatCellMeta {
  const key = inning as keyof NonNullable<PlayerAtBat["cellMeta"]>;
  return { ...emptyCellMeta(), ...(player.cellMeta?.[key] || {}) };
}
