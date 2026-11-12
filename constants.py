"""打席結果ラベル・正規化・集計ルールの一元定義。"""

from __future__ import annotations

# UI / AI / 集計で共通利用する公式ラベル（順序はセレクト表示用）
RESULT_OPTIONS: list[str] = [
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
]

RESULT_OPTIONS_SET = frozenset(RESULT_OPTIONS)

# AI や手入力で出やすい表記ゆれ → 公式ラベル
RESULT_ALIASES: dict[str, str] = {
    "1塁打": "単打",
    "１塁打": "単打",
    "ヒット": "単打",
    "安打": "単打",
    "シングル": "単打",
    "H": "単打",
    "1B": "単打",
    "2塁打": "二塁打",
    "２塁打": "二塁打",
    "二塁": "二塁打",
    "ツーベース": "二塁打",
    "2B": "二塁打",
    "3塁打": "三塁打",
    "３塁打": "三塁打",
    "三塁": "三塁打",
    "スリーベース": "三塁打",
    "3B": "三塁打",
    "ホームラン": "本塁打",
    "HR": "本塁打",
    "本塁": "本塁打",
    "四球": "四球",
    "フォアボール": "四球",
    "BB": "四球",
    "歩き": "四球",
    "死球": "死球",
    "デッドボール": "死球",
    "HBP": "死球",
    "DB": "死球",
    "三振": "三振",
    "空振り三振": "三振",
    "見逃し三振": "三振",
    "K": "三振",
    "SO": "三振",
    "凡打": "凡打",
    "アウト": "凡打",
    "ゴロ": "凡打",
    "フライ": "凡打",
    "ライナー": "凡打",
    "犠打": "犠打",
    "バント": "犠打",
    "犠牲バント": "犠打",
    "SH": "犠打",
    "犠飛": "犠飛",
    "犠牲フライ": "犠飛",
    "SF": "犠飛",
    "敵失": "敵失",
    "エラー": "敵失",
    "E": "敵失",
    "野選": "野選",
    "FC": "野選",
    "振り逃げ": "振り逃げ",
    "要確認": "要確認",
    "不明": "要確認",
    "？": "要確認",
    "?": "要確認",
    "なし": "なし",
    "無": "なし",
    "空白": "なし",
    "-": "なし",
    "—": "なし",
    "": "なし",
}

# 打数に含まれる結果（打席から四死球・犠牲を除いたもの）
AT_BAT_RESULTS = frozenset(
    {"単打", "二塁打", "三塁打", "本塁打", "凡打", "三振", "敵失", "野選", "振り逃げ"}
)

# 安打
HIT_RESULTS = frozenset({"単打", "二塁打", "三塁打", "本塁打"})

# 出塁に加算（安打以外）
ON_BASE_EXTRA = frozenset({"四球", "死球"})

# 打席数に含めない（未確定・打席なし）
NON_PA_RESULTS = frozenset({"なし", "要確認"})

# 塁打（total bases）への寄与
TOTAL_BASES_VALUE: dict[str, int] = {
    "単打": 1,
    "二塁打": 2,
    "三塁打": 3,
    "本塁打": 4,
}

# 出塁率の分母に含める犠牲フライ
OBP_SF = "犠飛"

INNING_KEYS = ("1", "2", "3", "4", "5", "6", "7")

DEFAULT_GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
    "gemini-1.5-flash",
]


def normalize_result(label) -> str:
    """任意の打席結果ラベルを公式ラベルへ正規化する。不明時は「要確認」。"""
    if label is None:
        return "要確認"
    text = str(label).strip()
    if text in RESULT_OPTIONS_SET:
        return text
    if text in RESULT_ALIASES:
        return RESULT_ALIASES[text]
    # 全角・半角スペース除去後も再試行
    compact = text.replace(" ", "").replace("　", "")
    if compact in RESULT_OPTIONS_SET:
        return compact
    if compact in RESULT_ALIASES:
        return RESULT_ALIASES[compact]
    return "要確認"


def is_plate_appearance(result: str) -> bool:
    return normalize_result(result) not in NON_PA_RESULTS


def is_at_bat(result: str) -> bool:
    return normalize_result(result) in AT_BAT_RESULTS


def is_hit(result: str) -> bool:
    return normalize_result(result) in HIT_RESULTS


def total_bases_for(result: str) -> int:
    return TOTAL_BASES_VALUE.get(normalize_result(result), 0)


def empty_innings() -> dict[str, str]:
    return {k: "なし" for k in INNING_KEYS}
