#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
统一 OVO / UwU 微信表情的“视觉大小”。

解决的问题：
- 腾讯 WebWeChat 雪碧图裁出的老表情，PNG 画布里透明留白较多；
- wechat-emoji-parser 的新版 PNG，主体通常更贴近画布边缘；
- 浏览器虽然把所有 <img> 设成同样宽高，但会连透明留白一起缩放，
  所以老表情看起来明显更小。

做法：
1. 读取 assets/wechat-emoji/order.json，只处理真正可发送的 99 张表情；
2. 用 alpha 通道找出每张图真正可见的主体；
3. 参考那批当前“大小正常”的新版表情，自动算一个目标视觉占比；
4. 裁掉透明留白，等比缩放，再居中放进统一 128×128 透明画布；
5. 第一次运行会备份原 PNG 到 assets/wechat-emoji-before-size-normalize/。

运行位置：
    OVO-web-clean 项目根目录

运行：
    python3 normalize_wechat_emoji_size.py
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from statistics import median

try:
    from PIL import Image
except ImportError:
    raise SystemExit(
        "缺少 Pillow。请先运行：\n"
        "python3 -m pip install pillow"
    )


ROOT = Path(__file__).resolve().parent
EMOJI_DIR = ROOT / "assets" / "wechat-emoji"
ORDER_FILE = EMOJI_DIR / "order.json"
BACKUP_DIR = ROOT / "assets" / "wechat-emoji-before-size-normalize"

CANVAS_SIZE = 128

# alpha 小于这个值的极淡抗锯齿像素，不参与“主体边界”的计算。
ALPHA_THRESHOLD = 8

# 用这批现在看起来大小正常的新版表情做标尺。
# 找不到某张会自动跳过。
REFERENCE_NAMES = [
    "高兴",
    "口罩",
    "笑哭",
    "傻呆",
    "恐惧",
    "悲伤",
    "不屑",
    "合十",
    "加油",
    "庆祝",
]

# 为防止某个参考图刚好贴边，把自动算出的视觉占比限制在这个区间。
MIN_TARGET_RATIO = 0.78
MAX_TARGET_RATIO = 0.92


def visible_bbox(img: Image.Image):
    """返回 alpha 主体边界。"""
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")

    mask = alpha.point(
        lambda a: 255 if a >= ALPHA_THRESHOLD else 0
    )

    return mask.getbbox()


def visible_ratio(img: Image.Image) -> float | None:
    """
    主体最长边 / 原画布最长边。
    例如主体 36px、画布 48px -> 0.75。
    """
    bbox = visible_bbox(img)

    if not bbox:
        return None

    left, top, right, bottom = bbox
    visible_w = right - left
    visible_h = bottom - top

    if visible_w <= 0 or visible_h <= 0:
        return None

    return max(visible_w, visible_h) / max(img.width, img.height)


def determine_target_ratio() -> float:
    ratios = []

    for name in REFERENCE_NAMES:
        path = EMOJI_DIR / f"{name}.png"

        if not path.exists():
            continue

        try:
            with Image.open(path) as img:
                ratio = visible_ratio(img)

            if ratio is not None:
                ratios.append(ratio)
                print(
                    f"参考 [{name}]："
                    f"可见主体占画布 {ratio:.1%}"
                )

        except Exception as exc:
            print(f"参考 [{name}] 读取失败：{exc}")

    if ratios:
        result = median(ratios)
    else:
        # 极端情况下参考图都不存在，使用一个保守默认值。
        result = 0.86

    result = max(
        MIN_TARGET_RATIO,
        min(MAX_TARGET_RATIO, result),
    )

    return result


def normalize_image(
    img: Image.Image,
    target_ratio: float,
) -> Image.Image:
    rgba = img.convert("RGBA")
    bbox = visible_bbox(rgba)

    if not bbox:
        return Image.new(
            "RGBA",
            (CANVAS_SIZE, CANVAS_SIZE),
            (0, 0, 0, 0),
        )

    # 用原 alpha bbox 裁主体，保留抗锯齿边缘像素。
    left, top, right, bottom = bbox

    # 给边缘留 1px 原图余量，避免 threshold 太狠切掉抗锯齿。
    left = max(0, left - 1)
    top = max(0, top - 1)
    right = min(rgba.width, right + 1)
    bottom = min(rgba.height, bottom + 1)

    cropped = rgba.crop(
        (left, top, right, bottom)
    )

    target_extent = round(
        CANVAS_SIZE * target_ratio
    )

    scale = min(
        target_extent / cropped.width,
        target_extent / cropped.height,
    )

    new_w = max(
        1,
        round(cropped.width * scale),
    )
    new_h = max(
        1,
        round(cropped.height * scale),
    )

    resized = cropped.resize(
        (new_w, new_h),
        Image.Resampling.LANCZOS,
    )

    canvas = Image.new(
        "RGBA",
        (CANVAS_SIZE, CANVAS_SIZE),
        (0, 0, 0, 0),
    )

    x = (CANVAS_SIZE - new_w) // 2
    y = (CANVAS_SIZE - new_h) // 2

    canvas.alpha_composite(
        resized,
        (x, y),
    )

    return canvas


def main():
    if not ORDER_FILE.exists():
        raise SystemExit(
            "找不到 assets/wechat-emoji/order.json。\n"
            "请确认脚本放在 OVO-web-clean 项目根目录。"
        )

    order = json.loads(
        ORDER_FILE.read_text(
            encoding="utf-8"
        )
    )

    if not isinstance(order, list) or not order:
        raise SystemExit(
            "order.json 不是有效的非空数组。"
        )

    print("=" * 64)
    print("UwU 微信表情视觉大小统一")
    print(f"共读取 {len(order)} 个可发送表情")
    print("=" * 64)

    target_ratio = determine_target_ratio()

    print(
        "\n自动标尺："
        f"主体最长边占统一画布 {target_ratio:.1%}"
    )
    print(
        f"统一输出：{CANVAS_SIZE}×{CANVAS_SIZE} PNG"
    )

    if not BACKUP_DIR.exists():
        BACKUP_DIR.mkdir(
            parents=True,
            exist_ok=True,
        )

        backed_up = 0

        for raw_name in order:
            name = str(raw_name).strip()
            src = EMOJI_DIR / f"{name}.png"

            if not src.exists():
                continue

            shutil.copy2(
                src,
                BACKUP_DIR / src.name,
            )
            backed_up += 1

        print(
            "\n✓ 已创建一次性备份："
            f"{BACKUP_DIR}"
        )
        print(
            f"✓ 备份 {backed_up} 张 PNG"
        )
    else:
        print(
            "\n✓ 已存在尺寸统一前备份，"
            "本次不会覆盖备份。"
        )

    print("\n开始统一大小……\n")

    success = 0
    missing = []
    failed = []

    for index, raw_name in enumerate(
        order,
        1,
    ):
        name = str(raw_name).strip()
        path = EMOJI_DIR / f"{name}.png"

        if not path.exists():
            missing.append(name)
            print(
                f"[{index:02d}/{len(order)}] "
                f"{name}.png → 缺失"
            )
            continue

        try:
            with Image.open(path) as img:
                before_ratio = visible_ratio(img)
                normalized = normalize_image(
                    img,
                    target_ratio,
                )

            temp_path = path.with_suffix(
                ".png.tmp"
            )

            normalized.save(
                temp_path,
                format="PNG",
                optimize=True,
            )

            temp_path.replace(path)
            success += 1

            before_text = (
                f"{before_ratio:.1%}"
                if before_ratio is not None
                else "无主体"
            )

            print(
                f"[{index:02d}/{len(order)}] "
                f"{name}.png "
                f"{before_text} → {target_ratio:.1%}"
            )

        except Exception as exc:
            failed.append(
                (name, str(exc))
            )
            print(
                f"[{index:02d}/{len(order)}] "
                f"{name}.png → 失败：{exc}"
            )

    print("\n" + "=" * 64)
    print("处理完成")
    print(f"成功：{success} 张")
    print(f"缺失：{len(missing)} 张")
    print(f"失败：{len(failed)} 张")
    print("=" * 64)

    if missing:
        print(
            "\n缺失文件："
            + "、".join(missing)
        )

    if failed:
        print("\n失败文件：")

        for name, reason in failed:
            print(
                f"  - {name}: {reason}"
            )

    print(
        "\n现在浏览器按 ⌘ + Shift + R 强刷。"
    )
    print(
        "如果你觉得整体还需要再大一点或小一点，"
        "只需要改脚本顶部的 MIN/MAX 或参考名单，"
        "不用动 CSS 和聊天渲染逻辑。"
    )


if __name__ == "__main__":
    main()
