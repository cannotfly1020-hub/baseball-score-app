"""画像加工・打席グリッド集計・Excel 出力。"""

from __future__ import annotations

import io

import pandas as pd
from PIL import Image, ImageEnhance

from constants import (
    INNING_KEYS,
    normalize_result,
    is_at_bat,
    is_hit,
    is_plate_appearance,
    total_bases_for,
)


def enhance_sharpness(pil_img: Image.Image) -> bytes:
    """高精細カラー解析のための鮮鋭化（コントラスト＆シャープネス強調）。"""
    img = pil_img.convert("RGB")
    img = ImageEnhance.Contrast(img).enhance(1.4)
    img = ImageEnhance.Sharpness(img).enhance(2.0)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def rotate_image_bytes(raw_bytes: bytes, degrees: int) -> bytes:
    """画像バイト列を時計回りに degrees 度回転して JPEG で返す。"""
    degrees = int(degrees) % 360
    if degrees == 0:
        return raw_bytes
    img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    # PIL は反時計回りなので符号反転
    img = img.rotate(-degrees, expand=True)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_player_record(player: dict) -> dict:
    """1選手レコードのイニングラベル等を正規化したコピーを返す。"""
    innings_in = player.get("innings") or {}
    innings = {}
    for key in INNING_KEYS:
        innings[key] = normalize_result(innings_in.get(key, "なし"))
    return {
        "match_date": str(player.get("match_date", "-") or "-"),
        "opponent": str(player.get("opponent", "-") or "-"),
        "batting_order": _safe_int(player.get("batting_order", 0)),
        "uniform_number": str(player.get("uniform_number", "") or "").strip(),
        "player_name": str(player.get("player_name", "") or "").strip(),
        "is_substitute": bool(player.get("is_substitute", False)),
        "rbi": _safe_int(player.get("rbi", 0)),
        "stolen_bases": _safe_int(player.get("stolen_bases", 0)),
        "innings": innings,
        "highlight": str(player.get("highlight", "") or "").strip(),
    }


def count_needs_review(player: dict) -> int:
    """要確認マスの個数。"""
    innings = (player.get("innings") or {})
    return sum(1 for k in INNING_KEYS if normalize_result(innings.get(k, "なし")) == "要確認")


def calculate_stats_from_grid(players_data: list, match_file_name: str = "") -> list:
    """盤面グリッドから公式ルールに近い打撃成績を1試合分集計する。"""
    compiled: list[dict] = []

    for raw in players_data:
        p = normalize_player_record(raw)
        singles = doubles = triples = homeruns = 0
        walks = deadballs = strikeouts = 0
        sacrifice_hits = sacrifice_flies = 0
        fielders_choice = errors = strikeout_wp = 0
        outs_in_play = 0
        plate_appearances = at_bats = hits = total_bases = 0

        for res in p["innings"].values():
            if not is_plate_appearance(res):
                continue
            plate_appearances += 1
            if is_at_bat(res):
                at_bats += 1
            if is_hit(res):
                hits += 1
                total_bases += total_bases_for(res)

            if res == "単打":
                singles += 1
            elif res == "二塁打":
                doubles += 1
            elif res == "三塁打":
                triples += 1
            elif res == "本塁打":
                homeruns += 1
            elif res == "四球":
                walks += 1
            elif res == "死球":
                deadballs += 1
            elif res == "三振":
                strikeouts += 1
            elif res == "犠打":
                sacrifice_hits += 1
            elif res == "犠飛":
                sacrifice_flies += 1
            elif res == "敵失":
                errors += 1
            elif res == "野選":
                fielders_choice += 1
            elif res == "振り逃げ":
                strikeout_wp += 1
                strikeouts += 1
            elif res == "凡打":
                outs_in_play += 1

        compiled.append(
            {
                "source_file": match_file_name,
                "match_date": p["match_date"],
                "opponent": p["opponent"],
                "batting_order": p["batting_order"],
                "uniform_number": p["uniform_number"],
                "player_name": p["player_name"],
                "is_substitute": p["is_substitute"],
                "plate_appearances": plate_appearances,
                "at_bats": at_bats,
                "singles": singles,
                "doubles": doubles,
                "triples": triples,
                "homeruns": homeruns,
                "hits": hits,
                "total_bases": total_bases,
                "walks": walks,
                "deadballs": deadballs,
                "walks_hbp": walks + deadballs,
                "strikeouts": strikeouts,
                "sacrifice_hits": sacrifice_hits,
                "sacrifice_flies": sacrifice_flies,
                "errors_reached": errors,
                "fielders_choice": fielders_choice,
                "strikeout_wildpitch": strikeout_wp,
                "in_play_outs": outs_in_play,
                "rbi": p["rbi"],
                "stolen_bases": p["stolen_bases"],
                "highlight": p["highlight"],
                "needs_review": count_needs_review(p),
            }
        )

    return compiled


def _rate_display(numerator: float, denominator: float) -> str:
    """打率・出塁率の表示（1.000 / .333 / .---）。"""
    if denominator <= 0:
        return ".---"
    rate = numerator / denominator
    if rate >= 1.0:
        return f"{rate:.3f}"
    return f".{int(round(rate * 1000)):03d}"


def _avg_display(hits: float, at_bats: float) -> str:
    return _rate_display(hits, at_bats)


def _obp_display(hits: float, walks: float, hbp: float, at_bats: float, sf: float) -> str:
    denom = at_bats + walks + hbp + sf
    return _rate_display(hits + walks + hbp, denom)


def aggregate_player_career(compiled_records: list) -> pd.DataFrame:
    """試合行リストから選手ごとの通算成績 DataFrame を作る。"""
    if not compiled_records:
        return pd.DataFrame()

    buckets: dict[str, dict] = {}
    for row in compiled_records:
        name = str(row.get("player_name", "")).strip()
        if not name:
            continue
        b = buckets.setdefault(
            name,
            {
                "player_name": name,
                "uniform_numbers": set(),
                "games": set(),
                "plate_appearances": 0,
                "at_bats": 0,
                "singles": 0,
                "doubles": 0,
                "triples": 0,
                "homeruns": 0,
                "hits": 0,
                "total_bases": 0,
                "walks": 0,
                "deadballs": 0,
                "strikeouts": 0,
                "sacrifice_hits": 0,
                "sacrifice_flies": 0,
                "rbi": 0,
                "stolen_bases": 0,
            },
        )
        src = str(row.get("source_file", "") or "")
        if src:
            b["games"].add(src)
        num = str(row.get("uniform_number", "") or "").strip()
        if num:
            b["uniform_numbers"].add(num)
        for key in (
            "plate_appearances",
            "at_bats",
            "singles",
            "doubles",
            "triples",
            "homeruns",
            "hits",
            "total_bases",
            "walks",
            "deadballs",
            "strikeouts",
            "sacrifice_hits",
            "sacrifice_flies",
            "rbi",
            "stolen_bases",
        ):
            b[key] += _safe_int(row.get(key, 0))

    rows = []
    for b in buckets.values():
        ab = b["at_bats"]
        h = b["hits"]
        bb = b["walks"]
        hbp = b["deadballs"]
        sf = b["sacrifice_flies"]
        rows.append(
            {
                "選手名": b["player_name"],
                "背番号": ", ".join(sorted(b["uniform_numbers"])),
                "試合数": len(b["games"]),
                "打席": b["plate_appearances"],
                "打数": ab,
                "単打": b["singles"],
                "二塁打": b["doubles"],
                "三塁打": b["triples"],
                "本塁打": b["homeruns"],
                "総安打": h,
                "塁打": b["total_bases"],
                "打点": b["rbi"],
                "盗塁": b["stolen_bases"],
                "四球": bb,
                "死球": hbp,
                "四死球": bb + hbp,
                "三振": b["strikeouts"],
                "犠打": b["sacrifice_hits"],
                "犠飛": sf,
                "打率": _avg_display(h, ab),
                "出塁率": _obp_display(h, bb, hbp, ab, sf),
                "_avg_raw": (h / ab) if ab > 0 else -1.0,
                "_obp_raw": ((h + bb + hbp) / (ab + bb + hbp + sf))
                if (ab + bb + hbp + sf) > 0
                else -1.0,
                "_hits": h,
                "_hr": b["homeruns"],
                "_rbi": b["rbi"],
                "_sb": b["stolen_bases"],
                "_ab": ab,
            }
        )

    df = pd.DataFrame(rows)
    if df.empty:
        return df
    return df.sort_values(by=["総安打", "打点", "選手名"], ascending=[False, False, True]).reset_index(
        drop=True
    )


def create_excel_from_compiled(compiled_records: list) -> bytes:
    """全試合明細 + 選手通算シート + 選手別明細の Excel を生成。"""
    output = io.BytesIO()
    df_all = pd.DataFrame(compiled_records) if compiled_records else pd.DataFrame()
    df_career = aggregate_player_career(compiled_records)

    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        if not df_all.empty:
            df_all.to_excel(writer, sheet_name="全打席成績一覧", index=False)
        else:
            pd.DataFrame({"message": ["データなし"]}).to_excel(
                writer, sheet_name="全打席成績一覧", index=False
            )

        if not df_career.empty:
            show = df_career.drop(
                columns=[c for c in df_career.columns if c.startswith("_")],
                errors="ignore",
            )
            show.to_excel(writer, sheet_name="選手通算成績", index=False)

            for _, crow in show.iterrows():
                player = crow["選手名"]
                df_player = df_all[df_all["player_name"] == player] if not df_all.empty else pd.DataFrame()
                sheet_title = str(player)[:28].replace("/", "_").replace("\\", "_") or "player"
                # シート名重複回避
                base = sheet_title
                n = 1
                existing = set(writer.book.sheetnames)
                while sheet_title in existing:
                    sheet_title = f"{base[:24]}_{n}"
                    n += 1
                if not df_player.empty:
                    df_player.to_excel(writer, sheet_name=sheet_title, index=False)

    return output.getvalue()
