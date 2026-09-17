import io
import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import openpyxl
from openpyxl.styles import Alignment, Font

# 打席結果の選択肢リスト（「要確認」を含む）
RESULT_OPTIONS = ["なし", "要確認", "単打", "2塁打", "3塁打", "本塁打", "四球", "死球", "三振", "凡打", "犠打"]

# ==========================================
# 画像前処理 1：高解像度・輪郭鮮鋭化処理（全体把握用）
# ==========================================
def enhance_sharpness(pil_img):
    """解像度・細部を維持しつつ、輪郭をくっきりさせる高画質処理"""
    rgb_img = pil_img.convert("RGB")
    sharpened = rgb_img.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
    enhancer_con = ImageEnhance.Contrast(sharpened)
    high_res = enhancer_con.enhance(1.2)
    
    buf = io.BytesIO()
    high_res.save(buf, format="JPEG", quality=98, subsampling=0)
    return buf.getvalue()

# ==========================================
# 画像前処理 2：赤ペン結線 特化抽出エンジン（赤線検証用）
# ==========================================
def extract_red_only(pil_img):
    """黒鉛筆やスコア枠線を消し去り、赤ペン・朱肉インクのみを強烈に浮き彫りにする処理"""
    rgb_img = pil_img.convert("RGB")
    r, g, b = rgb_img.split()
    
    r_arr = np.array(r, dtype=np.int16)
    g_arr = np.array(g, dtype=np.int16)
    b_arr = np.array(b, dtype=np.int16)
    
    # 赤の純度: Rが G や B よりどれだけ際立っているか
    # 黒鉛筆（R≒G≒B）や白い紙面は 0（真っ黒）になり、赤い筆跡だけがプラスになる
    redness = r_arr - np.maximum(g_arr, b_arr)
    redness = np.clip(redness * 4, 0, 255).astype(np.uint8)
    
    # コントラストを最大化して赤インクの線を白く発光させる
    red_mask = Image.fromarray(redness, mode="L")
    red_mask = ImageEnhance.Contrast(red_mask).enhance(3.0)
    
    # 黒背景に鮮烈な白〜赤の線として出力
    buf = io.BytesIO()
    red_mask.save(buf, format="JPEG", quality=95)
    return buf.getvalue()

# ==========================================
# 打席データからの成績集計
# ==========================================
def calculate_stats_from_grid(grid_players, match_file_name=""):
    compiled_records = []
    for p in grid_players:
        ab = 0
        hits = 0
        doubles = 0
        triples = 0
        hrs = 0
        so = 0
        bb = 0
        db = 0
        pa = 0

        for inn_str in ["1", "2", "3", "4", "5", "6", "7"]:
            res = p["innings"].get(inn_str, "なし")
            if res == "なし":
                continue
            pa += 1
            if res == "単打":
                hits += 1
                ab += 1
            elif res == "2塁打":
                doubles += 1
                ab += 1
            elif res == "3塁打":
                triples += 1
                ab += 1
            elif res == "本塁打":
                hrs += 1
                ab += 1
            elif res == "三振":
                so += 1
                ab += 1
            elif res == "凡打":
                ab += 1
            elif res == "四球":
                bb += 1
            elif res == "死球":
                db += 1
            elif res == "犠打":
                pass
            elif res == "要確認":
                pass

        compiled_records.append({
            "source_file": match_file_name,
            "match_date": p.get("match_date", "-"),
            "opponent": p.get("opponent", "-"),
            "batting_order": p.get("batting_order", 0),
            "uniform_number": str(p.get("uniform_number", "")).strip(),
            "player_name": str(p.get("player_name", "未登録")).strip(),
            "plate_appearances": pa,
            "at_bats": ab,
            "hits": hits,
            "doubles": doubles,
            "triples": triples,
            "homeruns": hrs,
            "strikeouts": so,
            "walks": bb,
            "dead_ball": db,
            "stolen_bases": int(p.get("stolen_bases", 0)),
            "rbi": int(p.get("rbi", 0)),
            "runs": 0,
            "highlight": p.get("highlight", "")
        })
    return compiled_records

# ==========================================
# 選手別シート付きExcelファイル作成
# ==========================================
def create_excel_from_compiled(all_records):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    players = {}
    for r in all_records:
        name = (r.get("player_name") or "未登録").strip()
        players.setdefault(name, []).append(r)

    headers = [
        "背番号", "試合日", "対戦相手", "打席", "打数", "安打", "2塁打", "3塁打", "本塁打",
        "三振", "四球", "死球", "盗塁", "打点", "得点", "ハイライト"
    ]

    for player_name, matches in players.items():
        sheet_title = player_name[:30] if player_name else "未登録"
        ws = wb.create_sheet(title=sheet_title)
        ws.append(headers)

        for col in range(1, len(headers) + 1):
            c = ws.cell(row=1, column=col)
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal="center")

        for m in matches:
            ws.append([
                m.get("uniform_number", ""),
                m.get("match_date", "-"),
                m.get("opponent", "-"),
                m.get("plate_appearances", 0),
                m.get("at_bats", 0),
                m.get("hits", 0),
                m.get("doubles", 0),
                m.get("triples", 0),
                m.get("homeruns", 0),
                m.get("strikeouts", 0),
                m.get("walks", 0),
                m.get("dead_ball", 0),
                m.get("stolen_bases", 0),
                m.get("rbi", 0),
                m.get("runs", 0),
                m.get("highlight", "")
            ])

    output = io.BytesIO()
    wb.save(output)
    return output.getvalue()
