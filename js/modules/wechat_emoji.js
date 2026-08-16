/* =========================================================
   微信黄豆表情模块 v0.2
   资源版本：微信 Android 6.5.10 老版黄豆

   目录结构：
   assets/
   └── wechat-emoji/
       ├── order.json
       ├── 微笑.png
       ├── 撇嘴.png
       ├── 色.png
       └── ...

   负责：
   1. 自动读取 order.json
   2. 根据表情名称生成 [表情名] token
   3. 自动对应同名 PNG
   4. 在消息输入框光标位置插入 token
   5. 给后续聊天气泡渲染提供统一查询接口

   注意：
   - 聊天记录中仍保存 [微笑] 这种纯文字
   - PNG 只用于界面显示
   ========================================================= */

window.WeChatEmoji = (() => {

    /* =====================================================
       0. 基础配置
       ===================================================== */

    const BASE_PATH = 'assets/wechat-emoji/';
    const ORDER_FILE = `${BASE_PATH}order.json`;

    let emojiList = [];
    let emojiMap = new Map();

    let loadPromise = null;
    let isLoaded = false;


    /* =====================================================
       1. 读取微信表情名单
       ===================================================== */

    async function load() {

        /*
         * 避免重复请求。
         * 如果已经开始加载，直接复用同一个 Promise。
         */
        if (loadPromise) {
            return loadPromise;
        }

        loadPromise = (async () => {

            try {

                const response = await fetch(ORDER_FILE, {
                    cache: 'no-cache'
                });

                if (!response.ok) {
                    throw new Error(
                        `无法读取微信表情列表：${response.status}`
                    );
                }

                const names = await response.json();

                if (!Array.isArray(names)) {
                    throw new Error(
                        'order.json 格式错误：顶层必须是数组'
                    );
                }

                /*
                 * 自动生成：
                 *
                 * 微笑
                 *
                 * ↓
                 *
                 * {
                 *   name: "微笑",
                 *   token: "[微笑]",
                 *   src: "assets/wechat-emoji/微笑.png"
                 * }
                 */
                emojiList = names
                    .filter(name =>
                        typeof name === 'string' &&
                        name.trim()
                    )
                    .map(name => {

                        const cleanName = name.trim();

                        return {
                            name: cleanName,
                            token: `[${cleanName}]`,
                            src: `${BASE_PATH}${cleanName}.png`
                        };
                    });


                /* ---------- token 快速查询表 ---------- */

                emojiMap = new Map(
                    emojiList.map(item => [
                        item.token,
                        item
                    ])
                );


                isLoaded = true;

                console.log(
                    `[WeChatEmoji] 已加载 ${emojiList.length} 个微信表情`
                );

                return emojiList;

            } catch (error) {

                console.error(
                    '[WeChatEmoji] 微信表情加载失败：',
                    error
                );

                /*
                 * 加载失败后允许以后再次尝试。
                 */
                loadPromise = null;
                isLoaded = false;

                throw error;
            }

        })();

        return loadPromise;
    }


    /* =====================================================
       2. 在输入框当前光标位置插入 token
       ===================================================== */

    function insertToken(token) {

        const input =
            document.getElementById('message-input');

        if (!input) {
            console.warn(
                '[WeChatEmoji] 未找到 #message-input'
            );
            return;
        }


        /*
         * textarea / input 都支持 selectionStart。
         * 如果浏览器暂时拿不到光标位置，就默认插在末尾。
         */
        const start =
            typeof input.selectionStart === 'number'
                ? input.selectionStart
                : input.value.length;

        const end =
            typeof input.selectionEnd === 'number'
                ? input.selectionEnd
                : input.value.length;


        const before =
            input.value.slice(0, start);

        const after =
            input.value.slice(end);


        input.value =
            before +
            token +
            after;


        /* ---------- 把光标放到 token 后面 ---------- */

        const newCursorPosition =
            start + token.length;

        input.focus();

        if (
            typeof input.setSelectionRange === 'function'
        ) {
            input.setSelectionRange(
                newCursorPosition,
                newCursorPosition
            );
        }


        /*
         * 主动通知 UwU：
         * 输入框内容发生变化。
         *
         * 这样原本依赖 input 事件的：
         * - 发送按钮状态
         * - 输入框高度
         * - 其他监听
         *
         * 都能正常工作。
         */
        input.dispatchEvent(
            new Event('input', {
                bubbles: true
            })
        );
    }


    /* =====================================================
       3. 根据 token 查询表情
       ===================================================== */

    function getEmojiByToken(token) {
        return emojiMap.get(token) || null;
    }


    /* =====================================================
       4. 根据名称查询表情
       ===================================================== */

    function getEmojiByName(name) {

        if (!name) {
            return null;
        }

        return getEmojiByToken(`[${name}]`);
    }


    /* =====================================================
       5. 判断 token 是否属于微信表情
       ===================================================== */

    function hasToken(token) {
        return emojiMap.has(token);
    }

/* =====================================================
   6. 把文本中的 [微信表情] 渲染成行内图片
   ===================================================== */

function renderInto(element, text) {

    if (!element) {
        return;
    }

    element.textContent = '';

    const source =
        text === null || text === undefined
            ? ''
            : String(text);


    /*
     * 模块没加载成功时保持纯文字，
     * 不影响正常聊天。
     */
    if (!isLoaded || emojiMap.size === 0) {
        element.textContent = source;
        return;
    }


    /*
     * 只寻找 [xxx] 这种片段。
     * 找到以后再检查它是不是我们真正拥有的微信表情。
     */
    const tokenRegex = /\[[^\[\]\r\n]+\]/g;

    let lastIndex = 0;
    let match;


    while ((match = tokenRegex.exec(source)) !== null) {

        /* ---------- token 前面的普通文字 ---------- */

        if (match.index > lastIndex) {
            element.appendChild(
                document.createTextNode(
                    source.slice(
                        lastIndex,
                        match.index
                    )
                )
            );
        }


        const token = match[0];
        const emoji = emojiMap.get(token);


        if (emoji) {

            /* ---------- 已知微信表情 ---------- */

            const img =
                document.createElement('img');

            img.className =
                'wechat-inline-emoji';

            img.src =
                emoji.src;

            img.alt =
                emoji.token;

            img.title =
                emoji.name;

            img.draggable =
                false;

            element.appendChild(img);

        } else {

            /*
             * 不是微信表情。
             * 比如 [发送时间:...] 或用户自己写的 [xxx]
             * 原样显示，不乱动。
             */
            element.appendChild(
                document.createTextNode(token)
            );
        }


        lastIndex =
            tokenRegex.lastIndex;
    }


    /* ---------- 最后一段普通文字 ---------- */

    if (lastIndex < source.length) {
        element.appendChild(
            document.createTextNode(
                source.slice(lastIndex)
            )
        );
        }
}
/* =====================================================
   扫描已有 DOM，把其中的微信 token 转成图片
   不破坏原本的 HTML 结构
   ===================================================== */

function renderInElement(root) {

    if (
        !root ||
        !isLoaded ||
        emojiMap.size === 0
    ) {
        return;
    }


    const walker =
        document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT
        );


    const textNodes = [];
    let node;


    /*
     * 先收集，不能边遍历边替换，
     * 否则 TreeWalker 容易被 DOM 修改扰乱。
     */
    while ((node = walker.nextNode())) {

        const parent =
            node.parentElement;

        if (!parent) {
            continue;
        }


        /*
         * 这些区域不处理。
         */
        if (
            parent.closest(
                'script, style, textarea, input, code, pre'
            )
        ) {
            continue;
        }


        /*
         * 已经生成好的黄豆图片不用再碰。
         */
        if (
            parent.classList.contains(
                'wechat-inline-emoji'
            )
        ) {
            continue;
        }


        if (
            node.nodeValue &&
            node.nodeValue.includes('[')
        ) {
            textNodes.push(node);
        }
    }


    textNodes.forEach(textNode => {

        const text =
            textNode.nodeValue;

        const tokenRegex =
            /\[[^\[\]\r\n]+\]/g;

        let lastIndex = 0;
        let match;
        let hasEmoji = false;

        const fragment =
            document.createDocumentFragment();


        while (
            (match = tokenRegex.exec(text)) !== null
        ) {

            const token =
                match[0];

            const emoji =
                emojiMap.get(token);


            if (!emoji) {
                continue;
            }


            hasEmoji = true;


            if (match.index > lastIndex) {
                fragment.appendChild(
                    document.createTextNode(
                        text.slice(
                            lastIndex,
                            match.index
                        )
                    )
                );
            }


            const img =
                document.createElement('img');

            img.className =
                'wechat-inline-emoji';

            img.src =
                emoji.src;

            img.alt =
                emoji.token;

            img.title =
                emoji.name;

            img.draggable =
                false;

            fragment.appendChild(img);


            lastIndex =
                tokenRegex.lastIndex;
        }


        /*
         * 这一整个文本节点里没有真正的微信表情，
         * 什么都不改。
         */
        if (!hasEmoji) {
            return;
        }


        if (lastIndex < text.length) {
            fragment.appendChild(
                document.createTextNode(
                    text.slice(lastIndex)
                )
            );
        }


        textNode.replaceWith(
            fragment
        );
    });
}

/* =====================================================
   给 AI 的微信黄豆使用说明
   ===================================================== */

function getAiPrompt() {

    if (!isLoaded || emojiList.length === 0) {
        return '';
    }

    const availableTokens =
        emojiList
            .map(item => item.token)
            .join(' ');

    return `
<wechat_inline_emoji>
你可以在聊天消息正文中自然使用微信内置表情。

使用方法：
直接输出对应的文字 token，例如：
- 好呀[微笑]
- 你又在干嘛[白眼]
- 笑死我了[偷笑]
- 我真的服了[捂脸]
- 晚安[亲亲]

这些 token 会由聊天客户端自动显示为真正的微信表情图片。

规则：
1. token 必须原样输出，例如 [微笑]。
2. 表情可以放在句首、句中或句尾，也可以单独作为一条消息。
3. 根据角色性格、语气和当前情绪自然选择，不要每句话都使用。
4. 不要为了使用表情而强行使用。
5. 只能使用下面存在的 token，不要自行创造不存在的微信表情名称。
6. 用户消息中出现这些 token 时，应理解为对应的表情和情绪。
7. 这是行内表情，不要使用“发送的表情包”等表情包消息格式。

可用微信表情：
${availableTokens}
</wechat_inline_emoji>
`.trim();
}


/* =========================================
   6. 对外接口
   ========================================= */

    return {

    /* 初始化 */
    load,

    /* 输入 */
    insertToken,

    /* 渲染 */
    renderInto,
    renderInElement,

    /* AI */
    getAiPrompt,

    /* 查询 */
        getEmojiByToken,
        getEmojiByName,
        hasToken,

        /* 状态 */
        get isLoaded() {
            return isLoaded;
        },

        /*
         * 用 getter，
         * 因为 emojiList 是异步加载后才产生的。
         */
        get emojiList() {
            return emojiList;
        },

        get emojiMap() {
            return emojiMap;
        }
    };

})();