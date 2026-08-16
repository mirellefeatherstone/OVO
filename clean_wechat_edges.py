from pathlib import Path
from PIL import Image
import shutil

# =========================================================
# 微信老黄豆 PNG 白边清理
# =========================================================

SOURCE_DIR = Path("assets/wechat-emoji")
BACKUP_DIR = Path("assets/wechat-emoji-original")

# 只处理距离透明区域多少像素以内的边缘
EDGE_RADIUS = 3

# 越高，越只处理接近白色的像素
WHITE_THRESHOLD = 165


def is_transparent(pixel):
    return pixel[3] <= 8


def near_transparent(pixels, x, y, width, height, radius):
    """判断当前像素附近是否存在透明背景。"""
    left = max(0, x - radius)
    right = min(width - 1, x + radius)
    top = max(0, y - radius)
    bottom = min(height - 1, y + radius)

    for yy in range(top, bottom + 1):
        for xx in range(left, right + 1):
            if is_transparent(pixels[xx, yy]):
                return True

    return False


def remove_white_matte(r, g, b, a):
    """
    尝试反推出原本被白色背景污染的半透明边缘。

    原截图边缘大致相当于：
    当前颜色 = 原颜色 * alpha + 白色 * (1-alpha)

    这里用 color-to-alpha 的方式把白色成分剥掉。
    """

    if a == 0:
        return r, g, b, a

    rf = r / 255.0
    gf = g / 255.0
    bf = b / 255.0
    af = a / 255.0

    # 对白色背景做 color-to-alpha
    matte_alpha = max(
        1.0 - rf,
        1.0 - gf,
        1.0 - bf
    )

    if matte_alpha <= 0.001:
        return r, g, b, 0

    # 和原 PNG 自带 alpha 合并
    new_alpha = af * matte_alpha

    def recover(c):
        c = c / 255.0

        value = (
            c - (1.0 - matte_alpha)
        ) / matte_alpha

        value = max(0.0, min(1.0, value))

        return round(value * 255)

    nr = recover(r)
    ng = recover(g)
    nb = recover(b)
    na = round(max(0.0, min(1.0, new_alpha)) * 255)

    return nr, ng, nb, na


def process_image(path):
    image = Image.open(path).convert("RGBA")

    width, height = image.size

    original = image.copy()
    src = original.load()
    dst = image.load()

    changed = 0

    for y in range(height):
        for x in range(width):

            r, g, b, a = src[x, y]

            if a == 0:
                continue

            # 只碰靠近透明背景的边缘
            if not near_transparent(
                src,
                x,
                y,
                width,
                height,
                EDGE_RADIUS
            ):
                continue

            # 明显不是白底污染的深色像素不处理
            if max(r, g, b) < WHITE_THRESHOLD:
                continue

            new_pixel = remove_white_matte(
                r,
                g,
                b,
                a
            )

            if new_pixel != (r, g, b, a):
                dst[x, y] = new_pixel
                changed += 1

    image.save(path, "PNG")

    return changed


def main():

    if not SOURCE_DIR.exists():
        raise SystemExit(
            f"找不到文件夹：{SOURCE_DIR}"
        )

    png_files = list(
        SOURCE_DIR.glob("*.png")
    )

    if not png_files:
        raise SystemExit(
            "wechat-emoji 里面没有找到 PNG"
        )

    # ---------- 首次运行自动备份 ----------

    if not BACKUP_DIR.exists():

        print("正在备份原始黄豆……")

        BACKUP_DIR.mkdir(
            parents=True,
            exist_ok=True
        )

        for path in png_files:
            shutil.copy2(
                path,
                BACKUP_DIR / path.name
            )

        print(
            f"原图已备份到：{BACKUP_DIR}"
        )

    else:
        print(
            "检测到已有备份，不重复覆盖。"
        )


    # ---------- 开始清理 ----------

    print(
        f"\n开始处理 {len(png_files)} 张 PNG……\n"
    )

    total_changed = 0

    for index, path in enumerate(
        sorted(png_files),
        start=1
    ):

        changed = process_image(path)

        total_changed += changed

        print(
            f"[{index:02d}/{len(png_files)}] "
            f"{path.name} "
            f"→ 修改 {changed} 像素"
        )


    print("\n==============================")
    print("黄豆洗澡完成 0﹃0")
    print(
        f"总共调整：{total_changed} 个边缘像素"
    )
    print(
        f"原始版本仍在：{BACKUP_DIR}"
    )
    print("==============================")


if __name__ == "__main__":
    main()