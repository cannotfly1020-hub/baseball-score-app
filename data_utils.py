import io
import pandas as pd
from PIL import Image, ImageEnhance

# 打席結果の完全選択肢（公式記録ルール準拠）
RESULT_OPTIONS = [
    "なし",
    "単打",
    "二塁打",
    "三塁打",
    "本塁打",
    "四球",
    "死球",
    "犠打",
    "犠飛",
    "凡打",
    "三振",
    "敵失",
    "野選",
    "振り逃げ"
]

def enhance_sharpness(pil_img: Image.Image) -> bytes:
    """高精細カラー解析のための鮮鋭化フィルター（コントラスト＆シャープネス強調）"""
    enhancer_contrast = ImageEnhance.Contrast(pil_img)
    img_contrasted = enhancer_contrast.enhance(1.4)
    enhancer_sharp = ImageEnhance.Sharpness(img_contrasted)
    img_sharp = enhancer_sharp.enhance(2.0)
    
    buf = io.BytesIO()
    img_sharp.save(buf, format="JPEG", quality=95)
    return buf.getvalue()

def calculate_stats_from_grid(players_data: list, match_file_name: str = "") -> list:
    """盤面グリッドから公式野球記録ルールに基づき成績を集計"""
    compiled_list = []
    
    for p in players_data:
        p_name = str(p.get("player_name", "")).strip()
        u_num = str(p.get("uniform_number", "")).strip()
        innings = p.get("innings", {})
        rbi = int(p.get("rbi", 0))
        sb = int(p.get("stolen_bases", 0))
        hl = str(p.get("highlight", "")).strip()

        plate_appearances = 0
        at_bats = 0
        hits = 0
        doubles = 0
        triples = 0
        homeruns = 0
        walks = 0
        deadballs = 0
        strikeouts = 0
        sacrifice_hits = 0
        sacrifice_flies = 0

        for inn_str, res in innings.items():
            if not res or res == "なし":
                continue
            
            plate_appearances += 1

            if res == "単打":
                at_bats += 1
                hits += 1
            elif res == "二塁打":
                at_bats += 1
                doubles += 1
            elif res == "三塁打":
                at_bats += 1
                triples += 1
            elif res == "本塁打":
                at_bats += 1
                homeruns += 1
            elif res == "四球":
                walks += 1
            elif res == "死球":
                deadballs += 1
            elif res == "犠打":
                sacrifice_hits += 1
            elif res == "犠飛":
                sacrifice_flies += 1
            elif res == "凡打":
                at_bats += 1
            elif res == "三振":
                at_bats += 1
                strikeouts += 1
            elif res == "敵失":
                at_bats += 1
            elif res == "野選":
                at_bats += 1
            elif res == "振り逃げ":
                at_bats += 1
                strikeouts += 1

        compiled_list.append({
            "source_file": match_file_name,
            "batting_order": p.get("batting_order", 0),
            "uniform_number": u_num,
            "player_name": p_name,
            "is_substitute": p.get("is_substitute", False),
            "plate_appearances": plate_appearances,
            "at_bats": at_bats,
            "hits": hits,
            "doubles": doubles,
            "triples": triples,
            "homeruns": homeruns,
            "walks": walks,
            "deadballs": deadballs,
            "strikeouts": strikeouts,
            "sacrifice_hits": sacrifice_hits,
            "sacrifice_flies": sacrifice_flies,
            "rbi": rbi,
            "stolen_bases": sb,
            "highlight": hl
        })

    return compiled_list

def create_excel_from_compiled(compiled_records: list) -> bytes:
    """全試合統合成績および選手個別シート付きのExcelバイナリを生成"""
    df_all = pd.DataFrame(compiled_records)
    output = io.BytesIO()

    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df_all.to_excel(writer, sheet_name="全打席成績一覧", index=False)

        # 選手ごとの個別シート
        players = df_all["player_name"].dropna().unique()
        for player in players:
            if not str(player).strip():
                continue
            df_player = df_all[df_all["player_name"] == player]
            sheet_title = str(player)[:28].replace("/", "_").replace("\\", "_")
            df_player.to_excel(writer, sheet_name=sheet_title, index=False)

    return output.getvalue()
