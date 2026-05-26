from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import json
import math
from textwrap import wrap


OUT_DIR = Path("/Users/myandong/Projects/42space/output/annotations")
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT = OUT_DIR / "42space-from-zero-to-one-infographic-v2.png"
AUDIT_OUT = OUT_DIR / "42space-from-zero-to-one-infographic-v2-audit.json"

FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"
W = 1800
M = 72


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


F = {
    "hero": font(70),
    "h1": font(46),
    "h2": font(34),
    "body": font(27),
    "small": font(22),
    "mini": font(18),
    "mono": font(22),
}

BG = (18, 12, 24)
PANEL = (31, 22, 40)
PANEL2 = (38, 27, 50)
LINE = (75, 57, 91)
WHITE = (248, 244, 255)
MUTED = (193, 181, 206)
DIM = (145, 134, 157)
PURPLE = (203, 82, 238)
CYAN = (68, 226, 223)
GREEN = (58, 216, 118)
ORANGE = (255, 175, 48)
RED = (255, 69, 101)
YELLOW = (255, 210, 80)
BLUE = (88, 156, 255)

SOURCES = [
    "Introduction: https://docs.42.space/getting-started/quickstart",
    "42 Markets: https://docs.42.space/getting-started/protocol-mechanics-101/42-markets",
    "Outcome Tokens: https://docs.42.space/getting-started/protocol-mechanics-101/42-outcome-tokens",
    "Power Curves: https://docs.42.space/getting-started/protocol-mechanics-101/42-power-curves",
    "Market Types: https://docs.42.space/getting-started/market-types",
    "Buying an outcome: https://docs.42.space/getting-started/publish-your-docs/trading-eventcoins/buying-an-outcome",
    "Market Discovery: https://docs.42.space/getting-started/protocol-mechanics-101/42-outcome-tokens/market-discovery-pre-resolution",
    "Post-Resolution: https://docs.42.space/getting-started/protocol-mechanics-101/42-outcome-tokens/post-resolution",
    "Convex Payout Dynamics: https://docs.42.space/getting-started/protocol-mechanics-101/convex-payout-dynamics",
]


def make_canvas(h: int):
    img = Image.new("RGB", (W, h), BG)
    return img, ImageDraw.Draw(img)


def tw(draw, text, ft):
    b = draw.textbbox((0, 0), text, font=ft)
    return b[2] - b[0]


def th(draw, text, ft):
    b = draw.textbbox((0, 0), text, font=ft)
    return b[3] - b[1]


def wrap_cjk(draw, text: str, ft, max_width: int, max_lines=None):
    lines, cur = [], ""
    for ch in text:
        test = cur + ch
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        if tw(draw, test, ft) <= max_width or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    truncated = False
    if max_lines and len(lines) > max_lines:
        truncated = True
        lines = lines[:max_lines]
        while lines[-1] and tw(draw, lines[-1] + "...", ft) > max_width:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "..."
    return lines, truncated


def draw_text_box(draw, x, y, text, ft, color, max_width, line_gap=10, max_lines=None):
    lines, truncated = wrap_cjk(draw, text, ft, max_width, max_lines=max_lines)
    yy = y
    for line in lines:
        draw.text((x, yy), line, font=ft, fill=color)
        yy += th(draw, line or "字", ft) + line_gap
    return yy, truncated


def rounded(draw, box, fill=PANEL, outline=LINE, radius=24, width=2):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def pill(draw, x, y, text, color, fill=None, ft=None):
    ft = ft or F["small"]
    pad_x, pad_y = 18, 9
    w = tw(draw, text, ft) + pad_x * 2
    h = th(draw, text, ft) + pad_y * 2
    draw.rounded_rectangle([x, y, x + w, y + h], radius=h // 2, fill=fill or (color[0] // 4, color[1] // 4, color[2] // 4), outline=color, width=2)
    draw.text((x + pad_x, y + pad_y - 2), text, font=ft, fill=WHITE)
    return x + w


def arrow(draw, p1, p2, color=PURPLE, width=5):
    x1, y1 = p1
    x2, y2 = p2
    draw.line([x1, y1, x2, y2], fill=color, width=width)
    ang = math.atan2(y2 - y1, x2 - x1)
    size = 16
    pts = [
        (x2, y2),
        (x2 - size * math.cos(ang - 0.42), y2 - size * math.sin(ang - 0.42)),
        (x2 - size * math.cos(ang + 0.42), y2 - size * math.sin(ang + 0.42)),
    ]
    draw.polygon(pts, fill=color)


def section_header(draw, y, idx, title, subtitle=None):
    draw.text((M, y), f"{idx}. {title}", font=F["h1"], fill=WHITE)
    if subtitle:
        draw_text_box(draw, M, y + 62, subtitle, F["body"], MUTED, W - 2 * M)
        return y + 125
    return y + 76


def draw_logo_mark(draw, x, y, s=1.0):
    c = PURPLE
    draw.line([x, y + 32 * s, x + 72 * s, y, x + 118 * s, y], fill=c, width=max(3, int(5 * s)))
    draw.line([x + 8 * s, y + 47 * s, x + 72 * s, y + 18 * s, x + 118 * s, y + 18 * s], fill=(180, 166, 255), width=max(3, int(5 * s)))
    draw.line([x + 34 * s, y + 64 * s, x + 88 * s, y + 39 * s], fill=c, width=max(3, int(5 * s)))


def card_title(draw, x, y, title, accent=PURPLE):
    draw.ellipse([x, y + 4, x + 20, y + 24], fill=accent)
    draw.text((x + 34, y), title, font=F["h2"], fill=WHITE)


def draw_flow(draw, x, y, width):
    labels = [
        ("未来事件", "一个具体问题"),
        ("多个结果", "BNB / HYPE / Draw"),
        ("Outcome Token", "每个结果一枚资产"),
        ("交易阶段", "买入、卖出、换仓"),
        ("结算", "赢家按份额分总池"),
    ]
    gap = 22
    box_w = (width - gap * 4) // 5
    box_h = 155
    for i, (a, b) in enumerate(labels):
        bx = x + i * (box_w + gap)
        color = [CYAN, PURPLE, BLUE, ORANGE, GREEN][i]
        rounded(draw, [bx, y, bx + box_w, y + box_h], fill=(28, 20, 37), outline=color, radius=22)
        draw.ellipse([bx + 22, y + 22, bx + 58, y + 58], fill=color)
        draw.text((bx + 76, y + 22), a, font=F["h2"], fill=WHITE)
        draw_text_box(draw, bx + 22, y + 80, b, F["body"], MUTED, box_w - 44, line_gap=6)
        if i < len(labels) - 1:
            arrow(draw, (bx + box_w + 4, y + box_h // 2), (bx + box_w + gap - 8, y + box_h // 2), color=color, width=4)
    return y + box_h


def draw_curve(draw, x, y, w, h):
    rounded(draw, [x, y, x + w, y + h], fill=PANEL, outline=CYAN, radius=24)
    card_title(draw, x + 34, y + 32, "Power Curve：需求越多，后买越贵", CYAN)
    px, py = x + 95, y + h - 80
    ax_w, ax_h = w - 190, h - 185
    draw.line([px, py, px + ax_w, py], fill=DIM, width=3)
    draw.line([px, py, px, py - ax_h], fill=DIM, width=3)
    draw.text((px + ax_w - 80, py + 22), "Supply", font=F["small"], fill=DIM)
    draw.text((px - 55, py - ax_h - 32), "Price", font=F["small"], fill=DIM)
    pts = []
    for i in range(90):
        t = i / 89
        xx = px + t * ax_w
        yy = py - (0.10 + 0.84 * (t ** 1.85)) * ax_h
        pts.append((xx, yy))
    draw.line(pts, fill=CYAN, width=7, joint="curve")
    draw.ellipse([pts[15][0] - 8, pts[15][1] - 8, pts[15][0] + 8, pts[15][1] + 8], fill=GREEN)
    draw.text((pts[15][0] - 22, pts[15][1] - 52), "早", font=F["body"], fill=GREEN)
    draw.ellipse([pts[72][0] - 8, pts[72][1] - 8, pts[72][0] + 8, pts[72][1] + 8], fill=ORANGE)
    draw.text((pts[72][0] - 22, pts[72][1] - 52), "晚", font=F["body"], fill=ORANGE)
    bullets = [
        "买入 = Mint：用户存入 USDT，协议按曲线发行 Outcome Tokens。",
        "价格不是订单簿撮合出来的，而是 supply 与 orderflow 的函数。",
        "同样一笔买入，越晚、越拥挤，平均价格通常越高。",
    ]
    yy = y + 110
    for b in bullets:
        draw_text_box(draw, x + 800, yy, "• " + b, F["body"], MUTED, w - 850, line_gap=8)
        yy += 74


def draw_pool(draw, x, y, w, h):
    rounded(draw, [x, y, x + w, y + h], fill=PANEL, outline=GREEN, radius=24)
    card_title(draw, x + 34, y + 32, "Parimutuel Settlement：赢家分总池", GREEN)
    base_y = y + 330
    bars = [("A", 5, CYAN), ("B", 2, PURPLE), ("C", 3, ORANGE)]
    max_v = 5
    bx = x + 80
    for i, (name, val, color) in enumerate(bars):
        bw = 95
        bh = int(190 * val / max_v)
        xx = bx + i * 150
        draw.rounded_rectangle([xx, base_y - bh, xx + bw, base_y], radius=16, fill=color)
        draw.text((xx + 20, base_y + 18), f"{name}: ${val}M", font=F["small"], fill=WHITE)
    arrow(draw, (x + 570, y + 240), (x + 730, y + 240), color=GREEN, width=5)
    rounded(draw, [x + 760, y + 145, x + 1210, y + 335], fill=(24, 36, 30), outline=GREEN, radius=24)
    draw.text((x + 800, y + 176), "如果 B 胜出", font=F["h2"], fill=WHITE)
    draw_text_box(draw, x + 800, y + 225, "A、C 的资金不会退回给 A/C；它们一起进入总池，由 B-OT 持有人按持币份额分。", F["body"], MUTED, 360)
    draw_text_box(draw, x + 1260, y + 152, "示例：A $5M + B $2M + C $3M = 总池 $10M\nB 赢：所有 B 持有人按 B-OT 占比分 $10M", F["body"], WHITE, w - 1310, line_gap=10)
    draw_text_box(draw, x + 80, y + 390, "公式：Your Payout = 你持有的获胜 Token 数 / 获胜 Token 总数 × Total Pool", F["body"], GREEN, w - 160)


def draw_market_card(draw, x, y, w, h):
    rounded(draw, [x, y, x + w, y + h], fill=PANEL, outline=PURPLE, radius=24)
    card_title(draw, x + 34, y + 32, "一张市场卡怎么看", PURPLE)
    # Mock market card
    mx, my = x + 70, y + 105
    mw, mh = 610, 380
    rounded(draw, [mx, my, mx + mw, my + mh], fill=(20, 14, 30), outline=(78, 58, 99), radius=22)
    draw.rounded_rectangle([mx + 26, my + 28, mx + 96, my + 98], radius=16, fill=BLUE)
    draw.text((mx + 116, my + 30), "HYPE vs BNB: Higher FDV?", font=F["h2"], fill=WHITE)
    headers = [("Outcome", mx + 28), ("MCap", mx + 275), ("24h chg%", mx + 390), ("Payout", mx + 520)]
    for text, xx in headers:
        draw.text((xx, my + 130), text, font=F["small"], fill=DIM)
    rows = [
        ("BNB", "$108.5K", "▲ 101.9K%", "1.1x"),
        ("HYPE", "$85.2K", "▲ 99.5K%", "1.3x"),
        ("Draw", "$4.5K", "▲ 18.5K%", "25.2x"),
    ]
    for i, row in enumerate(rows):
        yy = my + 178 + i * 54
        for j, val in enumerate(row):
            xx = [mx + 28, mx + 275, mx + 390, mx + 520][j]
            fill = GREEN if j == 2 else WHITE if j == 0 else MUTED
            draw.text((xx, yy), val, font=F["body"], fill=fill)
    draw.line([mx + 26, my + 325, mx + mw - 26, my + 325], fill=(67, 52, 82), width=2)
    draw.text((mx + 30, my + 342), "Vol $237.2K", font=F["small"], fill=MUTED)
    draw.text((mx + 210, my + 342), "🏆 $198.4K", font=F["small"], fill=MUTED)
    draw.text((mx + 425, my + 342), "212d left", font=F["small"], fill=YELLOW)
    explains = [
        ("Outcome", "可以买的结果，每一行都是一个 Outcome Token。"),
        ("MCap", "该结果当前资金规模，表示资金押注强弱。"),
        ("Payout", "如果该结果赢，当前价格对应的毛回报倍数。"),
        ("Vol", "这个市场累计成交量，代表活跃度。"),
        ("Ending In", "离交易停止/结算还有多久。"),
    ]
    ey = y + 110
    for name, desc in explains:
        rounded(draw, [x + 735, ey, x + w - 55, ey + 62], fill=PANEL2, outline=(86, 66, 105), radius=16)
        draw.text((x + 760, ey + 14), name, font=F["body"], fill=WHITE)
        draw_text_box(draw, x + 910, ey + 14, desc, F["small"], MUTED, w - 980, line_gap=4)
        ey += 78


def draw_market_types(draw, x, y, w, h):
    rounded(draw, [x, y, x + w, y + h], fill=PANEL, outline=BLUE, radius=24)
    card_title(draw, x + 34, y + 32, "两类市场：Event Markets vs Price Markets", BLUE)
    table_x, table_y = x + 60, y + 110
    col = [230, 620, 620]
    headers = ["维度", "Event Markets", "Price Markets"]
    rows = [
        ("主题", "事件结果", "资产价格区间"),
        ("周期", "开放到事件结束或计划结束", "固定 8 小时轮次"),
        ("定价", "Power Curve：需求/供给驱动", "Clock Curve：时间驱动"),
        ("退出", "结算前可以卖出", "买入后锁仓，不能卖出"),
        ("结算", "赢家按份额分总池", "命中价格区间者按份额分总池"),
    ]
    y0 = table_y
    for i, head in enumerate(headers):
        x0 = table_x + sum(col[:i])
        rounded(draw, [x0, y0, x0 + col[i] - 12, y0 + 64], fill=(34, 27, 52), outline=BLUE, radius=14)
        draw.text((x0 + 22, y0 + 16), head, font=F["body"], fill=WHITE)
    for r, row in enumerate(rows):
        yy = table_y + 82 + r * 74
        for i, cell in enumerate(row):
            x0 = table_x + sum(col[:i])
            rounded(draw, [x0, yy, x0 + col[i] - 12, yy + 60], fill=(25, 19, 34), outline=(58, 48, 72), radius=12, width=1)
            draw_text_box(draw, x0 + 20, yy + 14, cell, F["small"], WHITE if i == 0 else MUTED, col[i] - 52, line_gap=3, max_lines=2)


def draw_actions(draw, x, y, w, h):
    rounded(draw, [x, y, x + w, y + h], fill=PANEL, outline=ORANGE, radius=24)
    card_title(draw, x + 34, y + 32, "新手从 0 到 1 的操作路径", ORANGE)
    steps = [
        ("1", "先读规则", "看题目、Resolution、结束时间，确认你知道怎么判定输赢。"),
        ("2", "选市场", "New 适合早期小仓探索；Trending 看资金流；Ending 要想清楚卖出还是等结算。"),
        ("3", "选结果", "选择你认为被低估、或最终会胜出的 Outcome。"),
        ("4", "输入金额", "买入前看预览：价格、滑点、预估 payout 都会随别人交易变化。"),
        ("5", "买入/卖出/持有", "Event Markets 可在结算前卖出；Price Markets 通常锁仓到结算。"),
        ("6", "结算后 Claim", "如果你的 Outcome 赢，按你持有的获胜 Token 占比分总池；输了通常归零。"),
    ]
    sx, sy = x + 55, y + 110
    card_w = (w - 130) // 2
    for i, (n, title, body) in enumerate(steps):
        cx = sx + (i % 2) * (card_w + 35)
        cy = sy + (i // 2) * 135
        rounded(draw, [cx, cy, cx + card_w, cy + 108], fill=(26, 20, 36), outline=ORANGE, radius=18)
        draw.ellipse([cx + 20, cy + 24, cx + 72, cy + 76], fill=ORANGE)
        draw.text((cx + 39, cy + 30), n, font=F["h2"], fill=(30, 20, 20))
        draw.text((cx + 92, cy + 18), title, font=F["body"], fill=WHITE)
        draw_text_box(draw, cx + 92, cy + 56, body, F["small"], MUTED, card_w - 115, line_gap=4, max_lines=2)


def draw_risks(draw, x, y, w, h):
    rounded(draw, [x, y, x + w, y + h], fill=(35, 23, 38), outline=RED, radius=24)
    card_title(draw, x + 34, y + 32, "别跳过这些风险和误区", RED)
    items = [
        "价格不是官方概率，只是相对信念和资金流的表达。",
        "Payout 是动态的，不是下单时就固定锁死。",
        "卖出会受 redeem spread / tax 影响，越接近结算或卖出规模越大，成本可能越高。",
        "结算规则是核心：结果如何判定、数据源是什么、何时结算，都必须先看清。",
        "赢的 Outcome 才能 Claim；输的 Outcome 价值通常归零。",
    ]
    yy = y + 110
    for item in items:
        draw.ellipse([x + 58, yy + 7, x + 76, yy + 25], fill=RED)
        draw_text_box(draw, x + 95, yy, item, F["body"], WHITE, w - 140, line_gap=6)
        yy += 58


def draw_glossary(draw, x, y, w, h):
    rounded(draw, [x, y, x + w, y + h], fill=PANEL, outline=PURPLE, radius=24)
    card_title(draw, x + 34, y + 32, "一句话词典", PURPLE)
    terms = [
        ("Eventcoins", "未来事件结果资产；能交易，能转移，最后按规则结算。"),
        ("Outcome Tokens", "某个具体结果的代币；买 BNB/HYPE/Draw，本质是在持有对应 OT。"),
        ("Mint", "买入；向协议存入 USDT，按曲线铸造 OT。"),
        ("Redeem", "卖出；把 OT 按曲线换回抵押资产，扣除动态 spread。"),
        ("Claim", "结算后领奖；只有获胜 OT 可按份额领取总池。"),
        ("Resolution", "按预设规则和 oracle 条件判定最终获胜结果。"),
    ]
    tx, ty = x + 58, y + 112
    col_w = (w - 140) // 2
    for i, (term, desc) in enumerate(terms):
        cx = tx + (i % 2) * (col_w + 24)
        cy = ty + (i // 2) * 92
        draw.text((cx, cy), term, font=F["body"], fill=WHITE)
        draw_text_box(draw, cx, cy + 38, desc, F["small"], MUTED, col_w - 16, line_gap=3, max_lines=2)


def build():
    h = 9000
    img, draw = make_canvas(h)
    overflows = []

    # Hero
    y = 64
    draw_logo_mark(draw, M, y + 6, 0.9)
    draw.text((M + 150, y), "从 0 到 1 认识 42.space", font=F["hero"], fill=WHITE)
    y += 92
    draw_text_box(draw, M + 150, y, "事件结果像代币一样交易，最后像预测市场一样结算。", F["h2"], (221, 198, 255), W - 2 * M - 150)
    y += 88
    x = pill(draw, M, y, "基于 42 Docs MCP", CYAN)
    x = pill(draw, x + 18, y, "新手认知地图", PURPLE)
    pill(draw, x + 18, y, "中文图文版", GREEN)
    y += 92

    # One sentence
    rounded(draw, [M, y, W - M, y + 250], fill=(28, 20, 38), outline=PURPLE, radius=28)
    draw.text((M + 44, y + 36), "先用大白话理解", font=F["h1"], fill=WHITE)
    text = "42 是一个链上资产发行协议：它把“未来事件的每个可能结果”铸造成可交易的 Outcome Token。事件没结束前，这些结果代币可以像普通资产一样买卖；事件结束后，获胜结果的持有人按份额瓜分整个市场的抵押资金池。"
    yy, tr = draw_text_box(draw, M + 44, y + 105, text, F["body"], MUTED, W - 2 * M - 88, line_gap=12, max_lines=3)
    overflows.append(("intro", tr))
    y += 310

    y = section_header(draw, y, "01", "一条主线：事件 → 结果代币 → 连续交易 → 确定性结算")
    y = draw_flow(draw, M, y, W - 2 * M) + 95

    y = section_header(draw, y, "02", "它和普通预测市场最大的不同", "42 不只是在“押对错”。文档的核心设计是：让结果本身成为可流动资产，让价格在事件生命周期里连续表达信息。")
    col_w = (W - 2 * M - 34) // 2
    rounded(draw, [M, y, M + col_w, y + 300], fill=PANEL, outline=(80, 60, 90), radius=24)
    card_title(draw, M + 34, y + 32, "传统直觉", DIM)
    for i, item in enumerate(["赔率常被理解成固定回报", "流动性可能被不同结果切碎", "更多是在等最终开奖"]):
        draw_text_box(draw, M + 58, y + 105 + i * 58, "• " + item, F["body"], MUTED, col_w - 110)
    rounded(draw, [M + col_w + 34, y, W - M, y + 300], fill=PANEL, outline=PURPLE, radius=24)
    card_title(draw, M + col_w + 68, y + 32, "42 的设计", PURPLE)
    for i, item in enumerate(["每个结果都是 Outcome Token", "价格由曲线和资金流连续形成", "最终由获胜结果按比例分总池"]):
        draw_text_box(draw, M + col_w + 92, y + 105 + i * 58, "• " + item, F["body"], WHITE, col_w - 110)
    y += 380

    y = section_header(draw, y, "03", "为什么价格会动：Power Curve")
    draw_curve(draw, M, y, W - 2 * M, 510)
    y += 585

    y = section_header(draw, y, "04", "结算时钱怎么分：不是谁跟谁对赌，而是赢家分总池")
    draw_pool(draw, M, y, W - 2 * M, 520)
    y += 595

    y = section_header(draw, y, "05", "一张市场卡从哪里读起")
    draw_market_card(draw, M, y, W - 2 * M, 600)
    y += 675

    y = section_header(draw, y, "06", "两类市场别混淆")
    draw_market_types(draw, M, y, W - 2 * M, 590)
    y += 665

    y = section_header(draw, y, "07", "Trading Phase、卖出 spread、Redeem Tax 怎么理解")
    rounded(draw, [M, y, W - M, y + 390], fill=PANEL, outline=RED, radius=24)
    card_title(draw, M + 34, y + 32, "卖出不是无摩擦退出", RED)
    text = "在 Trading Phase，卖出价格会扣除 spread。这个 spread 会随时间和卖出规模变大，并回流到资金池，用来抵消稀释影响。文档中的 Redeem Tax 进一步解释：它会受到卖出规模、流动性深度、距离结算时间影响，目的是减少临近结算时的抢跑式退出，并保护仍持仓到结算的人。"
    yy, tr = draw_text_box(draw, M + 64, y + 110, text, F["body"], WHITE, W - 2 * M - 128, line_gap=12, max_lines=5)
    overflows.append(("trading_phase", tr))
    # mini pipeline
    steps = [("卖出 OT", PURPLE), ("按曲线估值", CYAN), ("扣 spread", RED), ("剩余给卖方", GREEN), ("spread 留在池中", ORANGE)]
    px = M + 120
    py = y + 275
    for i, (label, color) in enumerate(steps):
        bw = 220
        rounded(draw, [px + i * 300, py, px + i * 300 + bw, py + 70], fill=(28, 20, 36), outline=color, radius=20)
        draw.text((px + i * 300 + 34, py + 19), label, font=F["body"], fill=WHITE)
        if i < len(steps) - 1:
            arrow(draw, (px + i * 300 + bw + 14, py + 35), (px + (i + 1) * 300 - 22, py + 35), color=color, width=4)
    y += 465

    y = section_header(draw, y, "08", "新手怎么开始：从看懂到下单")
    draw_actions(draw, M, y, W - 2 * M, 570)
    y += 645

    y = section_header(draw, y, "09", "最后记住这张图的三句话")
    rounded(draw, [M, y, W - M, y + 245], fill=(28, 20, 38), outline=GREEN, radius=24)
    final = [
        "1. 买结果，本质是买 Outcome Token；不是买一个固定赔率的彩票。",
        "2. 价格来自资金流和曲线，payout 会随市场状态变化。",
        "3. 真正结算时，赢家按获胜 Token 的持有份额分整个总池。"
    ]
    for i, item in enumerate(final):
        draw_text_box(draw, M + 56, y + 42 + i * 58, item, F["body"], WHITE, W - 2 * M - 110)
    y += 320

    draw_risks(draw, M, y, W - 2 * M, 435)
    y += 500

    draw_glossary(draw, M, y, W - 2 * M, 420)
    y += 500

    # Sources
    rounded(draw, [M, y, W - M, y + 355], fill=(22, 16, 30), outline=(64, 49, 80), radius=24)
    draw.text((M + 34, y + 30), "资料来源（通过 42 Docs MCP 获取）", font=F["h2"], fill=WHITE)
    yy = y + 88
    for i, src in enumerate(SOURCES):
        col = i // 5
        row = i % 5
        xx = M + 34 + col * 820
        yy = y + 88 + row * 48
        draw_text_box(draw, xx, yy, "• " + src, F["mini"], MUTED, 760, line_gap=2, max_lines=1)
    y += 430

    # footer
    draw.text((M, y), "非投资建议。交易前请阅读每个市场的具体 Resolution / 规则 / 数据源。", font=F["small"], fill=(230, 180, 190))
    y += 90

    # Crop canvas to actual content height with padding.
    final_h = y + 10
    img = img.crop((0, 0, W, final_h))
    return img, overflows, final_h


img, overflows, final_h = build()
img.save(OUT, quality=96)

issues = []
for name, truncated in overflows:
    if truncated:
        issues.append({"type": "text_truncated", "section": name})
if final_h > 12000:
    issues.append({"type": "image_too_tall", "height": final_h})
if final_h > 9000:
    issues.append({"type": "canvas_too_short", "height": final_h})

audit = {
    "output": str(OUT),
    "size": [W, final_h],
    "source_count": len(SOURCES),
    "issues": issues,
    "notes": [
        "Content summarized from 42 Docs MCP pages.",
        "No raster AI redraw was used; image is deterministic PIL layout to preserve Chinese text accuracy.",
    ],
}
AUDIT_OUT.write_text(json.dumps(audit, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(audit, ensure_ascii=False, indent=2))
