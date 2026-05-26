from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import json
import math


SRC = Path("/Users/myandong/Library/Metadata/CoreSpotlight/PasteboardHistory/2026-05-26_09-32-51.png")
OUT_DIR = Path("/Users/myandong/Projects/42space/output/annotations")
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT = OUT_DIR / "42space-detail-field-annotations-v1-vertical.png"
AUDIT_OUT = OUT_DIR / "42space-detail-field-annotations-v1-vertical-audit.json"

FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


img = Image.open(SRC).convert("RGBA")
w, h = img.size
legend_h = 1120
canvas = Image.new("RGBA", (w, h + legend_h), (18, 12, 22, 255))
canvas.paste(img, (0, 0))
d = ImageDraw.Draw(canvas, "RGBA")

f_badge = font(21)
f_title = font(36)
f_legend = font(26)
f_small = font(21)

purple = (202, 82, 238, 255)
cyan = (74, 232, 228, 255)
green = (52, 215, 119, 255)
orange = (255, 171, 48, 255)
red = (255, 65, 92, 255)
blue = (74, 144, 255, 255)
yellow = (255, 207, 75, 255)
white = (248, 244, 255, 255)
muted = (192, 181, 205, 255)


def text_center(draw: ImageDraw.ImageDraw, xy, text: str, ft, fill):
    x, y = xy
    bbox = draw.textbbox((0, 0), text, font=ft)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((x - tw / 2, y - th / 2 - 1), text, font=ft, fill=fill)


def wrap_text(draw: ImageDraw.ImageDraw, text: str, ft, max_width: int, max_lines=2):
    lines = []
    current = ""
    for ch in text:
        test = current + ch
        width = draw.textbbox((0, 0), test, font=ft)[2]
        if width <= max_width or not current:
            current = test
        else:
            lines.append(current)
            current = ch
    if current:
        lines.append(current)
    truncated = False
    if len(lines) > max_lines:
        truncated = True
        lines = lines[:max_lines]
        while lines[-1] and draw.textbbox((0, 0), lines[-1] + "...", font=ft)[2] > max_width:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "..."
    return lines, truncated


# Rectangles are outline-first. The fill is intentionally faint so the screenshot remains readable.
highlights = [
    ((0, 0, w, 126), purple, "顶部账户栏"),
    ((74, 210, 1040, 348), cyan, "市场头部"),
    ((1350, 210, 2170, 348), cyan, "资金和阶段"),
    ((74, 392, 2170, 1260), cyan, "价格图表"),
    ((2205, 210, 2858, 1375), purple, "右侧交易面板"),
    ((74, 1356, 2170, 2205), orange, "下方明细表"),
]
overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
od = ImageDraw.Draw(overlay, "RGBA")
for rect, color, _ in highlights:
    x1, y1, x2, y2 = rect
    od.rounded_rectangle(
        [x1, y1, x2, y2],
        radius=18,
        outline=(color[0], color[1], color[2], 170),
        width=3,
        fill=(color[0], color[1], color[2], 9),
    )
canvas.alpha_composite(overlay, (0, 0))
d = ImageDraw.Draw(canvas, "RGBA")

# Numbering is vertical: page top to bottom. For same-height regions, read main content first, then the right trading panel.
entries = [
    (1, (260, 62), (190, 105), purple, "顶部导航：市场、作品集、排行榜、工作原理，切换页面或打开规则说明"),
    (2, (1405, 62), (1338, 105), purple, "搜索框：按关键词找市场"),
    (3, (2470, 62), (2385, 105), green, "账户区：存款、余额、未实现盈亏 U.PnL、当前钱包地址"),
    (4, (420, 240), (90, 205), cyan, "市场标题：这张图正在交易的问题，例：HYPE vs BNB 谁的 FDV 更高"),
    (5, (450, 278), (360, 320), cyan, "创建者：市场由谁发起；后面的地址是创建者钱包的缩写"),
    (6, (150, 320), (125, 372), cyan, "Timeframe：图表时间范围，1H/6H/1D/ALL 用来看不同时间跨度"),
    (7, (1398, 240), (1368, 338), cyan, "Total Pool Size：当前所有结果资金池合计，近似理解为这个市场里还在池中的钱"),
    (8, (1600, 240), (1568, 338), cyan, "Total Volume：累计成交量，历史买卖一共做了多少金额"),
    (9, (1850, 240), (1825, 338), red, "Market Phase：交易阶段；此阶段卖出会被扣 spread，随时间和卖出规模变大，回流资金池抵消稀释影响"),
    (10, (2075, 240), (2095, 338), yellow, "Ending In：离市场结束/结算还剩多久"),
    (11, (300, 416), (190, 455), cyan, "颜色图例：每条线代表一个结果；旁边价格是该结果当前份额价格"),
    (12, (1060, 760), (985, 720), cyan, "价格曲线：结果价格随交易变化；上涨代表市场更看好这个结果"),
    (13, (2050, 600), (1960, 496), cyan, "图上提示框：当前点的 Price 和 implied payout，价格越低赔率通常越高"),
    (14, (2116, 414), (2110, 470), purple, "图表设置：调整图表显示方式"),
    (15, (2400, 302), (2858, 275), green, "Buy / Sell：切换买入或卖出"),
    (16, (2435, 430), (2858, 390), purple, "当前选择的结果：这里选中 HYPE，点下拉可换 BNB 或 Draw"),
    (17, (2516, 535), (2858, 512), purple, "金额输入：输入想花多少钱买入"),
    (18, (2500, 620), (2858, 612), purple, "百分比滑杆：用账户余额的某个比例下单"),
    (19, (2575, 700), (2858, 700), purple, "Set slippage：设置可接受滑点；滑点太小可能成交失败"),
    (20, (2548, 774), (2858, 778), purple, "Enter Amount：提交下单；没填金额时不可用"),
    (21, (2520, 920), (2858, 894), cyan, "Outcomes：可买的所有结果；右侧 Implied payout 是当前隐含回报倍数"),
    (22, (2380, 1000), (2858, 1006), cyan, "Market cap：某个结果对应的资金规模，反映市场资金押注强弱"),
    (23, (2702, 1000), (2858, 1118), yellow, "Implied payout：若该结果赢，当前价格对应的毛回报倍数"),
    (24, (184, 1400), (88, 1326), orange, "Activity / Holders / Positions / Resolution：交易记录、持有人、你的持仓、结算信息"),
    (25, (220, 1486), (170, 1532), orange, "结果筛选：只看 HYPE、BNB 或 Draw 的交易记录"),
    (26, (130, 1585), (115, 1542), orange, "TIME：交易方向和发生时间；Bought 是买入，Sold 是卖出"),
    (27, (585, 1585), (540, 1542), orange, "AMOUNT：这笔交易金额"),
    (28, (875, 1585), (850, 1542), orange, "PRICE：成交时的份额价格"),
    (29, (1190, 1585), (1184, 1542), orange, "POOL SIZE：成交后对应结果资金池规模"),
    (30, (1495, 1585), (1480, 1542), red, "PNL：这笔卖出或持仓对应盈亏；红亏绿赚"),
    (31, (1830, 1585), (1850, 1542), orange, "USER：交易者钱包地址缩写"),
    (32, (180, 2490), (220, 2435), yellow, "UTC 时间：平台底部显示的当前 UTC 时间"),
    (33, (2690, 2490), (2645, 2435), yellow, "Docs / X / Discord：文档、社媒和社区入口"),
]

badge_boxes = []
for num, target, pos, color, _ in entries:
    bx, by = pos
    tx, ty = target
    if math.hypot(bx - tx, by - ty) > 34:
        d.line([bx, by, tx, ty], fill=(color[0], color[1], color[2], 210), width=2)
        d.ellipse([tx - 6, ty - 6, tx + 6, ty + 6], fill=color)
    r = 21
    d.ellipse([bx - r, by - r, bx + r, by + r], fill=(18, 12, 22, 245), outline=color, width=4)
    text_center(d, (bx, by), str(num), f_badge, white)
    badge_boxes.append((num, bx - r, by - r, bx + r, by + r))

ly = h
d.rectangle([0, ly, w, h + legend_h], fill=(18, 12, 22, 255))
d.line([0, ly, w, ly], fill=(202, 82, 238, 170), width=3)
d.text((52, ly + 34), "42.space 详情页字段批注（纵向阅读版）", font=f_title, fill=white)
d.text(
    (52, ly + 86),
    "阅读方式：从页面顶部往下读；同一高度时先读左侧市场/图表，再读右侧下单面板，最后读下方交易明细。",
    font=f_legend,
    fill=muted,
)
d.text(
    (52, ly + 128),
    "处理方式：保留原截图，不用模型重画；只叠加编号、细框和下方图例，避免 UI 文本被改错。",
    font=f_legend,
    fill=muted,
)

cols = 3
col_w = (w - 104) // cols
start_x = 52
start_y = ly + 190
row_h = 74
rows_per_col = math.ceil(len(entries) / cols)
legend_overflows = []
legend_boxes = []

for idx, (num, _, _, color, label) in enumerate(entries):
    col = idx // rows_per_col
    row = idx % rows_per_col
    x = start_x + col * col_w
    y = start_y + row * row_h
    box = [x, y, x + col_w - 28, y + 58]
    legend_boxes.append((num, *box))
    d.rounded_rectangle(box, radius=12, fill=(31, 22, 39, 235), outline=(color[0], color[1], color[2], 115), width=2)
    d.ellipse([x + 13, y + 12, x + 47, y + 46], fill=(18, 12, 22, 255), outline=color, width=3)
    text_center(d, (x + 30, y + 29), str(num), f_small, white)
    lines, truncated = wrap_text(d, label, f_legend, col_w - 95, max_lines=2)
    if truncated:
        legend_overflows.append({"num": num, "label": label})
    d.text((x + 62, y + 8), lines[0], font=f_legend, fill=white)
    if len(lines) > 1:
        d.text((x + 62, y + 35), lines[1], font=f_small, fill=muted)

note = "自检：编号全部在原图范围内；图例按纵向顺序分三列；没有使用大块不透明遮罩；Trading Phase 解释采用用户提供定义。"
d.text((52, h + legend_h - 56), note, font=f_small, fill=(178, 166, 194, 255))

issues = []
for num, x1, y1, x2, y2 in badge_boxes:
    if not (0 <= x1 < x2 <= w and 0 <= y1 < y2 <= h):
        issues.append({"type": "badge_out_of_bounds", "num": num, "box": [x1, y1, x2, y2]})
for i in range(len(badge_boxes)):
    n1, x1, y1, x2, y2 = badge_boxes[i]
    for j in range(i + 1, len(badge_boxes)):
        n2, a1, b1, a2, b2 = badge_boxes[j]
        area = max(0, min(x2, a2) - max(x1, a1)) * max(0, min(y2, b2) - max(y1, b1))
        if area > 0:
            issues.append({"type": "badge_overlap", "nums": [n1, n2], "area": area})
for item in legend_overflows:
    issues.append({"type": "legend_text_truncated", **item})
for num, x1, y1, x2, y2 in legend_boxes:
    if y2 > h + legend_h - 86:
        issues.append({"type": "legend_out_of_bounds", "num": num, "box": [x1, y1, x2, y2]})

audit = {
    "source": str(SRC),
    "output": str(OUT),
    "source_size": [w, h],
    "output_size": [w, h + legend_h],
    "entry_count": len(entries),
    "highlight_count": len(highlights),
    "issues": issues,
}

canvas.convert("RGB").save(OUT, quality=96)
AUDIT_OUT.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(audit, ensure_ascii=False, indent=2))
