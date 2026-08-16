#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
替换 UwU / OVO 的微信表情资源。

策略：
1. 优先从旧版 WebWeChat 的腾讯官方 qqemoji 雪碧图中裁切可映射表情。
2. 雪碧图中没有的新版表情，或官方 CDN 下载失败时，
   从 wechat-emoji-parser 的独立 PNG 资源补齐。
3. 保留 assets/wechat-emoji/order.json 不动，只覆盖同名 PNG。

运行位置：
    OVO-web-clean 项目根目录

运行：
    python3 replace_wechat_emoji_assets.py
"""

from __future__ import annotations

import io
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    raise SystemExit(
        "缺少 Pillow。请先运行：\n"
        "python3 -m pip install pillow"
    )


# =========================================================
# 0. 路径
# =========================================================

ROOT = Path(__file__).resolve().parent
EMOJI_DIR = ROOT / "assets" / "wechat-emoji"
ORDER_FILE = EMOJI_DIR / "order.json"

SOURCE_CACHE_DIR = ROOT / ".wechat-emoji-source-cache"
SOURCE_CACHE_DIR.mkdir(exist_ok=True)


# =========================================================
# 1. WebWeChat 官方 qqemoji 雪碧图
# =========================================================

# Retina 版优先；普通版作为备用。
OFFICIAL_SPRITE_URLS = [
    "https://res.wx.qq.com/a/wx_fed/webwx/res/static/img/3shEflO.png",
    "https://res.wx.qq.com/a/wx_fed/webwx/res/static/img/3gXSfR9.png",
]

# CSS 中的逻辑尺寸。
SPRITE_LOGICAL_WIDTH = 360
SPRITE_LOGICAL_HEIGHT = 192
CELL_LOGICAL_SIZE = 24
COLUMNS = 15


# 旧版 WebWeChat qqemoji 0..104。
QQFACE_NAMES = [
    "微笑", "撇嘴", "色", "发呆", "得意", "流泪", "害羞", "闭嘴", "睡", "大哭",
    "尴尬", "发怒", "调皮", "呲牙", "惊讶", "难过", "酷", "冷汗", "抓狂", "吐",
    "偷笑", "愉快", "白眼", "傲慢", "饥饿", "困", "惊恐", "流汗", "憨笑", "悠闲",
    "奋斗", "咒骂", "疑问", "嘘", "晕", "疯了", "衰", "骷髅", "敲打", "再见",
    "擦汗", "抠鼻", "鼓掌", "糗大了", "坏笑", "左哼哼", "右哼哼", "哈欠", "鄙视", "委屈",
    "快哭了", "阴险", "亲亲", "吓", "可怜", "菜刀", "西瓜", "啤酒", "篮球", "乒乓",
    "咖啡", "饭", "猪头", "玫瑰", "凋谢", "嘴唇", "爱心", "心碎", "蛋糕", "闪电",
    "炸弹", "刀", "足球", "瓢虫", "便便", "月亮", "太阳", "礼物", "拥抱", "强",
    "弱", "握手", "胜利", "抱拳", "勾引", "拳头", "差劲", "爱你", "NO", "OK",
    "爱情", "飞吻", "跳跳", "发抖", "怄火", "转圈", "磕头", "回头", "跳绳", "投降",
    "激动", "乱舞", "献吻", "左太极", "右太极",
]

QQFACE_INDEX = {name: i for i, name in enumerate(QQFACE_NAMES)}

# WebWeChat 里这几个后期表情继续占用 qqemoji 105..112。
QQFACE_INDEX.update({
    "嘿哈": 105,
    "捂脸": 106,
    "奸笑": 107,
    "机智": 108,
    "皱眉": 109,
    "耶": 110,
    "鸡": 111,
    "红包": 112,
})

# [囧] 在新版映射中使用 qqemoji17。
# 与旧代码中的“冷汗”共用/演变自同一位置。
QQFACE_INDEX["囧"] = 17


# =========================================================
# 2. 新版 PNG 备用来源
# =========================================================

PARSER_REPO_RAW = (
    "https://raw.githubusercontent.com/"
    "mingtianyihou33/wechat-emoji-parser/master/"
)

PARSER_CONFIG_URL = PARSER_REPO_RAW + "src/config/emoji.json"

# 你现在 order.json 的旧命名 -> 资源库中的标准中文命名
MODERN_NAME_ALIASES = {
    "高兴": "笑脸",
    "口罩": "生病",
    "笑哭": "破涕为笑",
    "傻呆": "脸红",
    "恐惧": "恐惧",
    "悲伤": "失望",
    "不屑": "无语",
    "嘿哈": "嘿哈",
    "捂脸": "捂脸",
    "奸笑": "奸笑",
    "机智": "机智",
    "皱眉": "皱眉",
    "耶": "耶",
    "合十": "合十",
    "庆祝": "庆祝",
    "礼物": "礼物",
    "红包": "红包",
    "鸡": "鸡",
}


# =========================================================
# 3. 下载工具
# =========================================================

def download_bytes(url: str, timeout: int = 20) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 Chrome/124 Safari/537.36"
            ),
            "Accept": "*/*",
        },
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def download_json(url: str):
    raw = download_bytes(url)
    return json.loads(raw.decode("utf-8"))


# =========================================================
# 4. 官方雪碧图
# =========================================================

def load_official_sprite():
    errors = []

    for i, url in enumerate(OFFICIAL_SPRITE_URLS):
        cache_name = "webwechat_qqemoji_retina.png" if i == 0 else "webwechat_qqemoji.png"
        cache_path = SOURCE_CACHE_DIR / cache_name

        try:
            if cache_path.exists():
                raw = cache_path.read_bytes()
                print(f"✓ 使用本地缓存：{cache_path.name}")
            else:
                print(f"正在下载腾讯 WebWeChat 表情雪碧图：\n  {url}")
                raw = download_bytes(url)
                cache_path.write_bytes(raw)
                print(f"✓ 已缓存：{cache_path}")

            image = Image.open(io.BytesIO(raw)).convert("RGBA")

            if image.width <= 0 or image.height <= 0:
                raise ValueError("图片尺寸异常")

            print(f"✓ 官方雪碧图尺寸：{image.width} × {image.height}")
            return image, url

        except Exception as exc:
            errors.append(f"{url}\n  {type(exc).__name__}: {exc}")
            print(f"× 官方雪碧图下载/读取失败：{type(exc).__name__}: {exc}")

    print("\n腾讯旧 CDN 当前不可用，将自动改用独立 PNG 备用来源。")
    return None, None


def crop_qqemoji(sprite: Image.Image, index: int) -> Image.Image:
    """
    CSS 逻辑空间是 360×192，格子间距 24px。
    Retina 图可能是 720×384，因此根据真实尺寸自动缩放坐标。
    """
    scale_x = sprite.width / SPRITE_LOGICAL_WIDTH
    scale_y = sprite.height / SPRITE_LOGICAL_HEIGHT

    if abs(scale_x - scale_y) > 0.02:
        raise ValueError(
            f"雪碧图缩放比例异常：x={scale_x:.3f}, y={scale_y:.3f}"
        )

    col = index % COLUMNS
    row = index // COLUMNS

    left = round(col * CELL_LOGICAL_SIZE * scale_x)
    top = round(row * CELL_LOGICAL_SIZE * scale_y)
    right = round((col + 1) * CELL_LOGICAL_SIZE * scale_x)
    bottom = round((row + 1) * CELL_LOGICAL_SIZE * scale_y)

    if right > sprite.width or bottom > sprite.height:
        raise ValueError(
            f"qqemoji{index} 超出雪碧图范围："
            f"{left},{top},{right},{bottom} / {sprite.size}"
        )

    return sprite.crop((left, top, right, bottom))


# =========================================================
# 5. 独立 PNG 备用
# =========================================================

def load_parser_config():
    cache_path = SOURCE_CACHE_DIR / "wechat_emoji_parser_emoji.json"

    try:
        if cache_path.exists():
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            print("✓ 使用本地表情配置缓存")
            return data

        print("正在下载新版表情配置……")
        raw = download_bytes(PARSER_CONFIG_URL)
        cache_path.write_bytes(raw)
        return json.loads(raw.decode("utf-8"))

    except Exception as exc:
        print(f"× 新版表情配置下载失败：{type(exc).__name__}: {exc}")
        return []


def build_parser_map(config):
    """
    返回：
        "微笑" -> "/src/assets/emojis/Smile.png"
    """
    result = {}

    for item in config:
        cn = str(item.get("cn", "")).strip()
        src = str(item.get("src", "")).strip()

        if not cn or not src:
            continue

        if cn.startswith("[") and cn.endswith("]"):
            cn = cn[1:-1]

        result[cn] = src

    return result


def download_parser_png(target_name: str, parser_map: dict[str, str]):
    lookup_name = MODERN_NAME_ALIASES.get(target_name, target_name)
    src = parser_map.get(lookup_name)

    if not src:
        return None, f"配置中没有 [{lookup_name}]"

    src = src.lstrip("/")
    quoted_path = urllib.parse.quote(src, safe="/!！-_.()")
    url = PARSER_REPO_RAW + quoted_path

    try:
        raw = download_bytes(url)
        image = Image.open(io.BytesIO(raw)).convert("RGBA")
        return image, url
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"


# =========================================================
# 6. 主流程
# =========================================================

def main():
    if not ORDER_FILE.exists():
        raise SystemExit(
            "找不到：assets/wechat-emoji/order.json\n"
            "请确认脚本放在 OVO-web-clean 项目根目录。"
        )

    try:
        order = json.loads(ORDER_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"order.json 读取失败：{exc}")

    if not isinstance(order, list) or not order:
        raise SystemExit("order.json 不是有效的非空数组。")

    EMOJI_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 62)
    print("UwU 微信表情资源替换")
    print(f"目标目录：{EMOJI_DIR}")
    print(f"order.json：{len(order)} 个表情")
    print("=" * 62)

    sprite, sprite_url = load_official_sprite()

    parser_config = load_parser_config()
    parser_map = build_parser_map(parser_config)

    official_count = 0
    fallback_count = 0
    kept_count = 0
    failed = []

    print("\n开始替换 PNG……\n")

    for n, raw_name in enumerate(order, 1):
        name = str(raw_name).strip()
        target = EMOJI_DIR / f"{name}.png"

        image = None
        source_label = ""

        # A. 官方 WebWeChat qqemoji
        index = QQFACE_INDEX.get(name)

        if sprite is not None and index is not None:
            try:
                image = crop_qqemoji(sprite, index)
                source_label = f"腾讯 WebWeChat qqemoji{index}"
                official_count += 1
            except Exception as exc:
                print(
                    f"[{n:02d}/{len(order)}] {name}.png "
                    f"官方裁切失败：{exc}"
                )

        # B. 独立 PNG 备用
        if image is None:
            fallback_image, fallback_info = download_parser_png(
                name,
                parser_map,
            )

            if fallback_image is not None:
                image = fallback_image
                source_label = "wechat-emoji-parser PNG"
                fallback_count += 1
            else:
                if target.exists():
                    kept_count += 1
                    print(
                        f"[{n:02d}/{len(order)}] {name}.png "
                        f"→ 保留现有文件（备用失败：{fallback_info}）"
                    )
                    continue

                failed.append((name, fallback_info))
                print(
                    f"[{n:02d}/{len(order)}] {name}.png "
                    f"→ 失败：{fallback_info}"
                )
                continue

        # 原子式保存：先写临时文件，再替换。
        temp = target.with_suffix(".png.tmp")

        try:
            image.save(temp, format="PNG", optimize=True)
            temp.replace(target)
            print(
                f"[{n:02d}/{len(order)}] {name}.png "
                f"→ {source_label} · {image.width}×{image.height}"
            )
        finally:
            if temp.exists():
                temp.unlink()

    print("\n" + "=" * 62)
    print("替换完成")
    print(f"腾讯 WebWeChat 官方雪碧图：{official_count} 张")
    print(f"独立 PNG 备用来源：        {fallback_count} 张")
    print(f"保留现有文件：             {kept_count} 张")
    print(f"彻底失败：                 {len(failed)} 张")
    print("=" * 62)

    if sprite_url:
        print(f"\n官方雪碧图来源：\n{sprite_url}")

    if failed:
        print("\n以下表情没有成功替换：")
        for name, reason in failed:
            print(f"  - {name}: {reason}")

        sys.exit(1)

    print(
        "\norder.json、wechat_emoji.js、渲染代码都没有修改。\n"
        "现在回浏览器按 ⌘ + Shift + R 强刷即可验收。"
    )


if __name__ == "__main__":
    main()
