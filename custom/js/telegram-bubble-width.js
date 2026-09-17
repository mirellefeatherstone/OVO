const CHAT_SCREEN_SELECTOR = '#chat-room-screen';
const MESSAGE_AREA_SELECTOR = `${CHAT_SCREEN_SELECTOR} .message-area`;
const BUBBLE_SELECTOR = '.message-bubble:not(.html-bubble)';
const CONTENT_SELECTOR = ':scope > .bubble-content, :scope > .bilingual-main-text, :scope > .translation-inner';
const TIMESTAMP_SELECTOR = ':scope > .message-time';
const MEASUREMENTS_PER_FRAME = 12;
const OPT_IN_PROPERTY = '--uwu-telegram-bubble-width';

const managedBubbles = new WeakSet();
const queuedBubbles = new Set();
const visibleBubbles = new Set();
let frameId = 0;

function getBubbleContents(bubble) {
    return Array.from(bubble.querySelectorAll(CONTENT_SELECTOR));
}

function isTextBubble(element) {
    return element instanceof HTMLElement
        && element.matches(BUBBLE_SELECTOR)
        && getBubbleContents(element).length > 0;
}

function toPixels(value) {
    return Number.parseFloat(value) || 0;
}

function measureRenderedContent(contents, bubble) {
    const bubbleStyle = getComputedStyle(bubble);
    const bubbleRect = bubble.getBoundingClientRect();
    const contentLeft = bubbleRect.left
        + toPixels(bubbleStyle.borderLeftWidth)
        + toPixels(bubbleStyle.paddingLeft);
    let widestLineRight = 0;
    let trailingLineRight = 0;
    let trailingLineBottom = -Infinity;

    contents.forEach(content => {
        const range = document.createRange();
        range.selectNodeContents(content);
        Array.from(range.getClientRects()).forEach(rect => {
            if (rect.width <= 0 || rect.height <= 0) return;

            const right = Math.max(0, rect.right - contentLeft);
            widestLineRight = Math.max(widestLineRight, right);

            if (rect.bottom > trailingLineBottom + 0.5) {
                trailingLineBottom = rect.bottom;
                trailingLineRight = right;
            } else if (Math.abs(rect.bottom - trailingLineBottom) <= 0.5) {
                trailingLineRight = Math.max(trailingLineRight, right);
            }
        });
    });

    return { widestLineRight, trailingLineRight };
}

function measureInlineTimestampWidth(bubble) {
    const timestamp = bubble.querySelector(TIMESTAMP_SELECTOR);
    if (!(timestamp instanceof HTMLElement) || timestamp.getClientRects().length === 0) return 0;

    const bubbleDisplay = getComputedStyle(bubble).display;
    if (bubbleDisplay === 'grid' || bubbleDisplay === 'inline-grid'
        || bubbleDisplay === 'flex' || bubbleDisplay === 'inline-flex') return 0;

    const style = getComputedStyle(timestamp);
    const isVisible = style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number.parseFloat(style.opacity) !== 0;
    const isInlineLayout = style.float !== 'none' || style.display.startsWith('inline');
    const isInFlow = style.position !== 'absolute' && style.position !== 'fixed';
    if (!isVisible || !isInlineLayout || !isInFlow) return 0;

    return timestamp.getBoundingClientRect().width
        + toPixels(style.marginLeft)
        + toPixels(style.marginRight);
}

function getDeclaredWidthForContentWidth(bubble, contentWidth) {
    const style = getComputedStyle(bubble);
    if (style.boxSizing !== 'border-box') return contentWidth;

    const horizontalExtras = Number.parseFloat(style.paddingLeft)
        + Number.parseFloat(style.paddingRight)
        + Number.parseFloat(style.borderLeftWidth)
        + Number.parseFloat(style.borderRightWidth);

    return contentWidth + horizontalExtras;
}

function fitBubbleWidth(bubble) {
    if (!bubble.isConnected || !isTextBubble(bubble)) return;
    if (bubble.getClientRects().length === 0) return;

    if (getComputedStyle(bubble).getPropertyValue(OPT_IN_PROPERTY).trim() !== '1') {
        if (managedBubbles.has(bubble)) {
            bubble.style.removeProperty('width');
            managedBubbles.delete(bubble);
        }
        return;
    }

    if (!managedBubbles.has(bubble)) {
        if (bubble.style.getPropertyValue('width')) return;
        managedBubbles.add(bubble);
    }

    const contents = getBubbleContents(bubble);
    bubble.style.width = 'max-content';

    const { widestLineRight, trailingLineRight } = measureRenderedContent(contents, bubble);
    const timestampWidth = measureInlineTimestampWidth(bubble);
    const renderedContentWidth = Math.max(
        widestLineRight,
        trailingLineRight + timestampWidth,
    );
    const declaredWidth = getDeclaredWidthForContentWidth(bubble, renderedContentWidth);
    bubble.style.width = `${Math.ceil(declaredWidth * 2) / 2}px`;
}

function processQueue() {
    frameId = 0;
    let processed = 0;

    for (const bubble of queuedBubbles) {
        queuedBubbles.delete(bubble);
        fitBubbleWidth(bubble);
        processed += 1;
        if (processed >= MEASUREMENTS_PER_FRAME) break;
    }

    if (queuedBubbles.size > 0) {
        frameId = requestAnimationFrame(processQueue);
    }
}

function queueBubble(bubble) {
    if (!isTextBubble(bubble)) return;
    queuedBubbles.add(bubble);
    if (!frameId) frameId = requestAnimationFrame(processQueue);
}

function findTextBubbles(root) {
    const bubbles = [];
    if (isTextBubble(root)) bubbles.push(root);

    if (root instanceof Element || root instanceof DocumentFragment) {
        root.querySelectorAll(BUBBLE_SELECTOR).forEach(bubble => {
            if (isTextBubble(bubble)) bubbles.push(bubble);
        });
    }

    return bubbles;
}

function setupTelegramBubbleWidths() {
    const messageArea = document.querySelector(MESSAGE_AREA_SELECTOR);
    if (!messageArea) return;

    const intersectionObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                visibleBubbles.add(entry.target);
                queueBubble(entry.target);
            } else {
                visibleBubbles.delete(entry.target);
            }
        });
    }, {
        root: messageArea,
        rootMargin: '160px 0px',
    });

    const observeBubbles = root => {
        findTextBubbles(root).forEach(bubble => intersectionObserver.observe(bubble));
    };

    observeBubbles(messageArea);

    const mutationObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(observeBubbles);

            const bubble = mutation.target instanceof Element
                ? mutation.target.closest(BUBBLE_SELECTOR)
                : mutation.target.parentElement?.closest(BUBBLE_SELECTOR);
            if (bubble && visibleBubbles.has(bubble)) queueBubble(bubble);
        });
    });

    mutationObserver.observe(messageArea, {
        childList: true,
        characterData: true,
        subtree: true,
    });

    new MutationObserver(() => {
        visibleBubbles.forEach(queueBubble);
    }).observe(document.head, {
        childList: true,
        characterData: true,
        subtree: true,
    });

    let messageAreaWidth = messageArea.clientWidth;
    const resizeObserver = new ResizeObserver(entries => {
        const nextWidth = entries[0]?.contentRect.width || 0;
        if (Math.abs(nextWidth - messageAreaWidth) < 0.5) return;

        messageAreaWidth = nextWidth;
        visibleBubbles.forEach(queueBubble);
    });
    resizeObserver.observe(messageArea);

    document.fonts?.addEventListener?.('loadingdone', () => {
        visibleBubbles.forEach(queueBubble);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTelegramBubbleWidths, { once: true });
} else {
    setupTelegramBubbleWidths();
}
