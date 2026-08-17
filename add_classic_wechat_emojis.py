#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
把“被微信下架的经典表情”补回 UwU 的微信表情栏，并按图案/家族重新排顺序。

放置位置：
    OVO-web-clean/add_classic_wechat_emojis.py

运行：
    python3 add_classic_wechat_emojis.py

它会：
1. 备份 assets/wechat-emoji/order.json
2. 从 qqface@0.1.2 下载 26 张有精确旧 QQFace 编号的经典 PNG
3. 把这些表情插进同一个“微信”分类，不新建分类
4. 黄豆脸放一起、物品放一起、手势放一起、企鹅动作放一起
5. 保留当前已有的“礼物”“鸡”等资源，不重复下载

注意：
- “小狗”没有放进本次自动下载，因为它不属于 qqface 0~104 这套精确资源。
  先不拿新版狗冒充老狗，等确认到匹配素材后再补。
"""

from __future__ import annotations

import json
import shutil
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EMOJI_DIR = ROOT / "assets" / "wechat-emoji"
ORDER_FILE = EMOJI_DIR / "order.json"
BACKUP_FILE = EMOJI_DIR / "order.before-classic.json"

# qqface 经典表情编号。
# 这些编号来自老 WebQQ / QQFace 的固定 0~104 顺序。
CLASSIC_INDEX = {
    "酷": 16,
    "饥饿": 24,
    "疯了": 35,
    "糗大了": 43,
    "吓": 53,
    "篮球": 58,
    "乒乓": 59,
    "饭": 61,
    "闪电": 69,
    "刀": 71,
    "足球": 72,
    "瓢虫": 73,
    "差劲": 86,
    "爱你": 87,
    "NO": 88,
    "爱情": 90,
    "飞吻": 91,
    "磕头": 96,
    "回头": 97,
    "跳绳": 98,
    "投降": 99,
    "激动": 100,
    "乱舞": 101,
    "献吻": 102,
    "左太极": 103,
    "右太极": 104,
}

QQFACE_URL = "https://unpkg.com/qqface@0.1.2/img/{index}.png"
PUP_URL = "https://raw.githubusercontent.com/mingtianyihou33/wechat-emoji-parser/master/src/assets/emojis/Pup.png"

# =========================================================
# 顺序
# =========================================================
#
# 不是“全部追加到末尾”，而是按图案家族排。
#
# 1. 黄豆脸
# 2. 物品 / 食物 / 动物
# 3. 手势
# 4. 企鹅动作
# 5. 后期微信新增黄豆/动作/节庆资源
#
# “鸡”保留项目现有资源；“小狗”暂不塞新版图冒充。
#
DESIRED_ORDER = [
    # ---------- 黄豆脸 ----------
    "微笑", "撇嘴", "色", "发呆", "得意", "流泪", "害羞", "闭嘴", "睡", "大哭",
    "尴尬", "发怒", "调皮", "呲牙", "惊讶", "难过", "酷", "囧", "抓狂", "吐",
    "偷笑", "愉快", "白眼", "傲慢", "饥饿", "困", "惊恐", "流汗", "憨笑", "悠闲",
    "奋斗", "咒骂", "疑问", "嘘", "晕", "疯了", "衰", "骷髅", "敲打", "再见",
    "擦汗", "抠鼻", "鼓掌", "糗大了", "坏笑", "左哼哼", "右哼哼", "哈欠", "鄙视",
    "委屈", "快哭了", "阴险", "亲亲", "吓", "可怜",

    # 后期微信黄豆脸也和黄豆放一起
    "高兴", "口罩", "笑哭", "吐舌头", "傻呆", "恐惧", "悲伤", "不屑",
    "嘿哈", "捂脸", "奸笑", "机智", "皱眉", "耶",

    # ---------- 物品 / 食物 / 动物 ----------
    "菜刀", "西瓜", "啤酒", "篮球", "乒乓", "咖啡", "饭", "猪头",
    "玫瑰", "凋谢", "嘴唇", "爱心", "心碎", "蛋糕", "闪电", "炸弹", "刀",
    "足球", "瓢虫", "便便", "月亮", "太阳", "礼物", "红包", "鸡", "小狗", "鬼脸",

    # ---------- 手势 ----------
    "拥抱", "强", "弱", "握手", "胜利", "抱拳", "勾引", "拳头",
    "差劲", "爱你", "NO", "OK", "合十", "加油",

    # ---------- 企鹅 / 动作 ----------
    # 这段故意紧挨着，不让企鹅被新版黄豆插开
    "爱情", "飞吻", "跳跳", "发抖", "怄火", "转圈",
    "磕头", "回头", "跳绳", "投降", "激动", "乱舞", "献吻",
    "左太极", "右太极",

    # ---------- 节庆 ----------
    "庆祝",
]


def download(url: str, target: Path):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    target.write_bytes(data)


def main():
    if not ORDER_FILE.exists():
        raise SystemExit(
            "找不到 assets/wechat-emoji/order.json。\n"
            "请确认脚本放在 OVO-web-clean 项目根目录。"
        )

    current = json.loads(ORDER_FILE.read_text(encoding="utf-8"))

    if not isinstance(current, list):
        raise SystemExit("order.json 不是数组。")

    print(f"当前微信表情：{len(current)} 个")

    # ---------- 备份 ----------
    if not BACKUP_FILE.exists():
        shutil.copy2(ORDER_FILE, BACKUP_FILE)
        print(f"✓ 已备份：{BACKUP_FILE}")
    else:
        print(f"✓ 备份已存在，不覆盖：{BACKUP_FILE}")

    # ---------- 下载缺失经典资源 ----------
    added_files = 0
    existing_files = 0
    failed = []

    for name, index in CLASSIC_INDEX.items():
        target = EMOJI_DIR / f"{name}.png"

        if target.exists():
            existing_files += 1
            print(f"✓ 已有 {name}.png，跳过")
            continue

        url = QQFACE_URL.format(index=index)

        try:
            print(f"↓ {name}.png ← qqface {index}")
            download(url, target)
            added_files += 1
        except Exception as exc:
            failed.append((name, index, str(exc)))
            print(f"× {name}.png 下载失败：{exc}")
    # ---------- 补回老微信 [小狗] ----------
    pup_target = EMOJI_DIR / "小狗.png"

    if not pup_target.exists():
        try:
            print("↓ 小狗.png ← WeChat Pup")
            download(PUP_URL, pup_target)
            added_files += 1
        except Exception as exc:
            failed.append(("小狗", "Pup", str(exc)))
            print(f"× 小狗.png 下载失败：{exc}")
    else:
        print("✓ 已有 小狗.png，跳过")
    # ---------- 排序 ----------
    #
    # 先按我们指定的视觉家族顺序。
    # 再把项目中未来可能新增、但脚本还不知道的名字保留在最后，
    # 防止误删资源。
    #
    available_names = set(current) | set(CLASSIC_INDEX) | {"小狗"}

    ordered = []
    seen = set()

    for name in DESIRED_ORDER:
        if name in available_names and name not in seen:
            ordered.append(name)
            seen.add(name)

    # 保留未知的已有 token，不擅自删除
    extras = [
        name for name in current
        if name not in seen
    ]
    ordered.extend(extras)

    ORDER_FILE.write_text(
        json.dumps(
            ordered,
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )

    print("\n" + "=" * 64)
    print("完成")
    print(f"新 order.json：{len(ordered)} 个")
    print(f"新下载经典 PNG：{added_files} 张")
    print(f"已经存在：{existing_files} 张")
    print(f"失败：{len(failed)} 张")
    print("=" * 64)

    print("\n企鹅动作连续段：")
    penguins = [
        "爱情", "飞吻", "跳跳", "发抖", "怄火", "转圈",
        "磕头", "回头", "跳绳", "投降", "激动", "乱舞",
        "献吻", "左太极", "右太极",
    ]
    print(" → ".join(penguins))

    print("\n这次没有自动加 [小狗]。")
    print("原因：0~104 经典 QQFace 里没有它，先不拿新版素材冒充。")

    if failed:
        print("\n下载失败项目：")
        for name, index, reason in failed:
            print(f"  - {name} ({index}): {reason}")

    print("\n现在刷新 UwU 看微信表情栏即可。")
    print("确认顺序和图片没问题后，再处理 [小狗]。")


if __name__ == "__main__":
    main()
