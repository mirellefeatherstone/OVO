/* =========================================================
   UwU · 微信骰子 / 猜拳 v0.3
   - 最终态改用微信风格透明素材
   - 猜拳动画直接循环：布 → 剪刀 → 石头
   - 骰子动画保留旧版微信 Action 帧；加载失败时循环本地骰子图
   - 聊天中统一显示 65px
   ========================================================= */
(() => {
  'use strict';

  const VERSION = '0.3';
  const ROLL_MS = 5000;
  const DICE_INTERVAL = 100;
  const RPS_INTERVAL = 166;
  const ASSET_BASE = 'assets/wechat-game';

  const DICE = {
    1: `${ASSET_BASE}/dice-1.png`,
    2: `${ASSET_BASE}/dice-2.png`,
    3: `${ASSET_BASE}/dice-3.png`,
    4: `${ASSET_BASE}/dice-4.png`,
    5: `${ASSET_BASE}/dice-5.png`,
    6: `${ASSET_BASE}/dice-6.png`
  };

  const RPS = [
    { name: '布',   src: `${ASSET_BASE}/rps-paper.png` },
    { name: '剪刀', src: `${ASSET_BASE}/rps-scissors.png` },
    { name: '石头', src: `${ASSET_BASE}/rps-rock.png` }
  ];

  const OLD_DICE_FRAMES = [0,1,2,3].map(i =>
    `https://raw.githubusercontent.com/alexiscn/WeChatSwift/master/WeChatSwift/Supporting%20Files/Assets.xcassets/dice_Action_${i}_100x100_.imageset/dice_Action_${i}_100x100_@1x.png`
  );

  let diceFramesPromise = null;
  let uiObserver = null;
  let messageObserver = null;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function randomInt(max) {
    if (window.crypto?.getRandomValues) {
      const arr = new Uint32Array(1);
      const range = 0x100000000;
      const limit = range - (range % max);

      do {
        window.crypto.getRandomValues(arr);
      } while (arr[0] >= limit);

      return arr[0] % max;
    }

    return Math.floor(Math.random() * max);
  }

  function getSendSticker() {
    if (typeof window.sendSticker === 'function') {
      return window.sendSticker;
    }

    try {
      if (typeof sendSticker === 'function') {
        return sendSticker;
      }
    } catch (_) {}

    return null;
  }

  function resolveImage(url, fallback) {
    return new Promise(resolve => {
      const image = new Image();
      let settled = false;

      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      const timer = setTimeout(() => finish(fallback), 2200);

      image.onload = () => finish(url);
      image.onerror = () => finish(fallback);
      image.src = url;
    });
  }

  function getDiceFrames() {
    if (diceFramesPromise) {
      return diceFramesPromise;
    }

    // 远程老微信 Action 帧失效时，也绝不再回退到丑 canvas。
    // 直接用本地微信风格骰子素材快速轮播。
    const fallback = [
      DICE[2],
      DICE[5],
      DICE[3],
      DICE[6]
    ];

    diceFramesPromise = Promise.all(
      OLD_DICE_FRAMES.map((url, index) =>
        resolveImage(url, fallback[index])
      )
    );

    return diceFramesPromise;
  }

  function normalize(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, '');
  }

  // AI 只能请求「骰子 / 猜拳」。
  // 点数 / 手势永远到客户端这里才随机。
  function resolveAiStickerName(name) {
    const normalized = normalize(name);

    // AI 只能决定“要掷骰子”。
    // 即使它擅自写了 骰子·6点，也把 6 点丢掉重新随机。
    if (/^骰子(?:[·:：-]?[1-6]点?)?$/.test(normalized)) {
      return `骰子·${randomInt(6) + 1}点`;
    }

    // AI 只能决定“要猜拳”。
    // 猜拳·石头 / 剪刀 / 布 都只是请求，具体结果重新随机。
    if (
      /^(?:猜拳|石头剪刀布)(?:[·:：-]?(?:石头|剪刀|布))?$/.test(normalized)
    ) {
      return `猜拳·${RPS[randomInt(RPS.length)].name}`;
    }

    return null;
  }

  function parseResolvedName(name) {
    const normalized = normalize(name);

    let match = normalized.match(
      /^骰子[·:：-]?([1-6])点?$/
    );

    if (match) {
      return {
        type: 'dice',
        value: Number(match[1]),
        name: `骰子·${match[1]}点`
      };
    }

    match = normalized.match(
      /^猜拳[·:：-]?(剪刀|石头|布)$/
    );

    if (match) {
      return {
        type: 'rps',
        value: match[1],
        name: `猜拳·${match[1]}`
      };
    }

    return null;
  }

  function getResolvedSticker(name) {
    const parsed = parseResolvedName(name);

    if (!parsed) {
      return null;
    }

    if (parsed.type === 'dice') {
      return {
        id: `wechat_game_dice_${parsed.value}`,
        name: parsed.name,
        data: DICE[parsed.value],
        description: `微信骰子，随机结果：${parsed.value}点`,
        __wechatGame: true,
        gameType: 'dice',
        gameValue: parsed.value
      };
    }

    const item = RPS.find(
      entry => entry.name === parsed.value
    );

    if (!item) {
      return null;
    }

    return {
      id: `wechat_game_rps_${parsed.value}`,
      name: parsed.name,
      data: item.src,
      description: `微信猜拳，随机结果：${parsed.value}`,
      __wechatGame: true,
      gameType: 'rps',
      gameValue: parsed.value
    };
  }

  function markGameImage(image) {
    if (!image) return;

    image.classList.add('wechat-game-image');
    image.draggable = false;
  }

  async function animateImage(image, gameName) {
    if (
      !image ||
      image.dataset.wechatGamePlaying === '1'
    ) {
      return;
    }

    const parsed = parseResolvedName(gameName);
    const finalSticker = getResolvedSticker(gameName);

    if (!parsed || !finalSticker) {
      return;
    }

    let frames;
    let interval;

    if (parsed.type === 'dice') {
      frames = await getDiceFrames();
      interval = DICE_INTERVAL;
    } else {
      // 微信猜拳本来就是三个手势循环。
      frames = RPS.map(item => item.src);
      interval = RPS_INTERVAL;
    }

    markGameImage(image);

    image.dataset.wechatGamePlaying = '1';
    image.removeAttribute('srcset');

    const start = performance.now();
    let index = 0;

    while (
      image.isConnected &&
      performance.now() - start < ROLL_MS
    ) {
      image.src = frames[index % frames.length];
      index += 1;
      await wait(interval);
    }

    if (image.isConnected) {
      image.src = finalSticker.data;
    }

    image.dataset.wechatGamePlayed = '1';
    delete image.dataset.wechatGamePlaying;
  }

  async function waitForNewUserSticker(
    beforeSet,
    timeout = 3000
  ) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const images = [
        ...document.querySelectorAll(
          '#message-area .sticker-bubble img'
        )
      ];

      const found = images.find(
        image => !beforeSet.has(image)
      );

      if (found) {
        return found;
      }

      await wait(25);
    }

    return null;
  }

  // 不加 busy。
  // 连续点两下，就是两颗完全独立随机的骰子 / 猜拳。
  async function sendUserGame(type) {
    const send = getSendSticker();

    if (!send) {
      if (typeof showToast === 'function') {
        showToast('表情发送功能还没加载好');
      }
      return;
    }

    const resolvedName = type === 'dice'
      ? `骰子·${randomInt(6) + 1}点`
      : `猜拳·${RPS[randomInt(RPS.length)].name}`;

    const sticker = getResolvedSticker(resolvedName);

    if (!sticker) {
      return;
    }

    const beforeSet = new Set(
      document.querySelectorAll(
        '#message-area .sticker-bubble img'
      )
    );

    Promise.resolve(
      send({
        id: `${sticker.id}_${Date.now()}_${Math.random()}`,
        name: sticker.name,
        data: sticker.data,
        description: sticker.description,
        wechatGame: true,
        gameType: sticker.gameType,
        gameValue: sticker.gameValue
      })
    ).catch(error => {
      console.error(
        '[WeChatGame] user send failed',
        error
      );
    });

    const image = await waitForNewUserSticker(
      beforeSet
    );

    if (image) {
      animateImage(image, resolvedName);
    }
  }

  function ensureStyle() {
    const oldStyle = document.getElementById(
      'wechat-game-v02-style'
    );

    if (oldStyle) {
      oldStyle.remove();
    }

    if (
      document.getElementById(
        'wechat-game-v03-style'
      )
    ) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'wechat-game-v03-style';

    style.textContent = `
/* 聊天里的最终大小。图本身已经有阴影，所以这里不叠 CSS 阴影。 */
#message-area img.wechat-game-image,
#message-area img[src*="assets/wechat-game/dice-"],
#message-area img[src*="assets/wechat-game/rps-"] {
    width: 65px !important;
    height: 65px !important;
    max-width: 65px !important;
    max-height: 65px !important;
    object-fit: contain !important;
    filter: none !important;
}

/* 微信表情栏里的两颗特殊表情，直接跟黄豆住一起。 */
.wechat-game-item img {
    object-fit: contain !important;
}
        `.trim();

    document.head.appendChild(style);
  }

  function gameTile(type, label, src) {
    const item = document.createElement('div');

    item.className =
      'wechat-emoji-item wechat-game-item';

    item.dataset.wechatGame = type;
    item.title = label;

    const image = document.createElement('img');
    image.src = src;
    image.alt = label;
    image.draggable = false;

    item.appendChild(image);

    item.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      sendUserGame(type);
    });

    return item;
  }

  function injectTiles() {
    const grid = document.getElementById(
      'sticker-grid-container'
    );

    if (
      !grid ||
      !grid.classList.contains(
        'wechat-emoji-mode'
      )
    ) {
      return;
    }

    if (
      grid.querySelector(
        '[data-wechat-game="dice"]'
      )
    ) {
      return;
    }

    grid.appendChild(
      gameTile('dice', '骰子', DICE[5])
    );

    grid.appendChild(
      gameTile(
        'rps',
        '猜拳',
        RPS.find(item => item.name === '石头').src
      )
    );
  }

  function setupUiObserver() {
    if (uiObserver || !document.body) {
      return;
    }

    uiObserver = new MutationObserver(
      injectTiles
    );

    uiObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class']
    });
  }

  // chat_render 的 v0.2 patch 会给 AI 新游戏消息挂 data 属性。
  // 这里只负责识别“刚刚生成”的消息并播放一次。
  function setupAiAnimationObserver() {
    if (
      messageObserver ||
      !document.body
    ) {
      return;
    }

    messageObserver = new MutationObserver(
      mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) {
              continue;
            }

            const bubbles = [];

            if (
              node.matches?.(
                '.sticker-bubble[data-wechat-game-name]'
              )
            ) {
              bubbles.push(node);
            }

            node.querySelectorAll?.(
              '.sticker-bubble[data-wechat-game-name]'
            ).forEach(
              bubble => bubbles.push(bubble)
            );

            for (const bubble of bubbles) {
              if (
                bubble.dataset
                  .wechatGameAnimated === '1'
              ) {
                continue;
              }

              const timestamp = Number(
                bubble.dataset
                  .wechatGameTimestamp || 0
              );

              if (
                !timestamp ||
                Math.abs(
                  Date.now() - timestamp
                ) > 10000
              ) {
                continue;
              }

              const image =
                bubble.querySelector('img');

              if (!image) {
                continue;
              }

              bubble.dataset
                .wechatGameAnimated = '1';

              animateImage(
                image,
                bubble.dataset.wechatGameName
              );
            }
          }
        }
      }
    );

    messageObserver.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  function markHistoricalImages() {
    document.querySelectorAll(
      '#message-area img[src*="assets/wechat-game/"]'
    ).forEach(markGameImage);
  }

  function boot() {
    document.getElementById(
      'wechat-game-item'
    )?.remove();

    document.getElementById(
      'wechat-game-sheet'
    )?.remove();

    ensureStyle();
    injectTiles();
    markHistoricalImages();
    setupUiObserver();
    setupAiAnimationObserver();

    console.log(
      `[WeChatGame] v${VERSION} loaded`
    );
  }

  window.WeChatGame = {
    version: VERSION,
    resolveAiStickerName,
    parseResolvedName,
    getResolvedSticker,
    animateImage,
    sendDice: () => sendUserGame('dice'),
    sendRps: () => sendUserGame('rps')
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      boot,
      { once: true }
    );
  } else {
    boot();
  }
})();

/* ===== 微信小游戏视觉尺寸修正 ===== */
(() => {
  const style = document.createElement('style');
  style.id = 'wechat-game-size-fix';

  style.textContent = `
    /* 最终骰子：图片本身透明留白较多，所以放大主体 */
    #message-area img[src*="assets/wechat-game/dice-"] {
      transform: scale(1.28) !important;
      transform-origin: center center !important;
    }

    /* 骰子滚动帧：原始素材主体太大，缩到和最终骰子接近 */
    #message-area img.wechat-game-image[src*="dice_Action_"] {
      transform: scale(1) !important;
      transform-origin: center center !important;
    }

    /* 猜拳保持原来的 65px 视觉大小 */
    #message-area img.wechat-game-image[src*="assets/wechat-game/rps-"] {
      transform: scale(1) !important;
      transform-origin: center center !important;
    }
  `;

  document.getElementById('wechat-game-size-fix')?.remove();
  document.head.appendChild(style);
})();

/* ===== AI 小游戏防作弊硬锁 ===== */
(() => {
  if (!window.WeChatGame) return;

  function secureRandomInt(max) {
    if (window.crypto?.getRandomValues) {
      const arr = new Uint32Array(1);
      const range = 0x100000000;
      const limit = range - (range % max);

      do {
        crypto.getRandomValues(arr);
      } while (arr[0] >= limit);

      return arr[0] % max;
    }

    return Math.floor(Math.random() * max);
  }

  window.WeChatGame.resolveAiStickerName = function(name) {
    const n = String(name || '')
      .trim()
      .replace(/\s+/g, '');

    /* AI 写没写点数都不算数，客户端重新掷 */
    if (
      /^骰子$/.test(n) ||
      /^骰子[·:：-]?[1-6]点?$/.test(n)
    ) {
      return `骰子·${secureRandomInt(6) + 1}点`;
    }

    /* AI 写没写石头剪刀布都不算数，客户端重新抽 */
    if (
      /^(猜拳|石头剪刀布)$/.test(n) ||
      /^猜拳[·:：-]?(石头|剪刀|布)$/.test(n)
    ) {
      const result = ['石头', '剪刀', '布'][secureRandomInt(3)];
      return `猜拳·${result}`;
    }

    return null;
  };

  console.log('[WeChatGame] AI 防作弊锁已启用');
})();
