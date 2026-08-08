const IMAGE_VISUAL_TOKEN_ESTIMATE = 1400;
const PATCH_STATE_KEY = '__ovoImageTokenEstimatePatchV1';
const IMAGE_DATA_URL_PATTERN = /^data:image\/[^;,]+(?:;[^,]*)*;base64,[\s\S]+$/i;

function isImageDataUrl(value) {
    return typeof value === 'string'
        && IMAGE_DATA_URL_PATTERN.test(value.trim());
}

// Keep this identical to OVO's estimateTokenFromText() so subtracting an
// accidentally-counted Data URL reverses the original estimate exactly.
function estimateTokenFromText(text) {
    if (!text || typeof text !== 'string') return 0;

    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = text.length - chinese;
    return Math.ceil(chinese * 1.2 + other * 0.4);
}

function getMessageImageCount(message) {
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const partImageCount = parts.filter(part => (
        part?.type === 'image' && part.data
    )).length;

    if (partImageCount > 0) return partImageCount;

    // Older OVO records may only have the image Data URL in content.
    return isImageDataUrl(message?.content) ? 1 : 0;
}

function usesWholeContentHistory(db, chat, chatType) {
    if (chatType !== 'private') return true;
    if (db.magicRoom?.customPromptEnabled) return true;

    if (!chat.customPromptPreset || !Array.isArray(db.magicRoom?.presets)) {
        return false;
    }

    return db.magicRoom.presets.some(preset => (
        preset?.name === chat.customPromptPreset
    ));
}

function getImageTokenAdjustment(db, chat, chatType) {
    const history = (chat.history || [])
        .slice(-(chat.maxMemory || 20))
        .filter(message => !message.isContextDisabled);

    const wholeContentHistory = usesWholeContentHistory(db, chat, chatType);
    let lastAiIndex = -1;

    if (!wholeContentHistory) {
        for (let index = history.length - 1; index >= 0; index -= 1) {
            const role = history[index]?.role;
            if (role === 'assistant' || role === 'char') {
                lastAiIndex = index;
                break;
            }
        }
    }

    let imageCount = 0;
    let dataUrlTextTokens = 0;

    history.forEach((message, index) => {
        const messageImageCount = getMessageImageCount(message);
        if (messageImageCount === 0) return;

        imageCount += messageImageCount;

        if (!isImageDataUrl(message.content)) return;

        let originalCountedContent = wholeContentHistory;
        if (!wholeContentHistory) {
            const isTriggerMessage = lastAiIndex === -1 || index > lastAiIndex;
            const hasParts = Array.isArray(message.parts) && message.parts.length > 0;

            // The detailed private-chat branch replaces content with parts for
            // completed history, but reads content directly for trigger turns.
            originalCountedContent = isTriggerMessage || !hasParts;
        }

        if (originalCountedContent) {
            dataUrlTextTokens += estimateTokenFromText(message.content);
        }
    });

    return {
        imageCount,
        dataUrlTextTokens,
        delta: imageCount * IMAGE_VISUAL_TOKEN_ESTIMATE - dataUrlTextTokens,
    };
}

function installImageTokenEstimatePatch() {
    if (window[PATCH_STATE_KEY]) return;

    const originalGetChatTokenBreakdown = window.getChatTokenBreakdown;
    const originalEstimateChatTokens = window.estimateChatTokens;

    if (typeof originalGetChatTokenBreakdown !== 'function'
        || typeof originalEstimateChatTokens !== 'function') {
        console.warn('[OVO custom] Image Token estimate patch could not find OVO Token functions.');
        return;
    }

    function patchedGetChatTokenBreakdown(chatId, chatType = 'private') {
        const originalBreakdown = originalGetChatTokenBreakdown.call(
            window,
            chatId,
            chatType,
        );

        if (!originalBreakdown || !window.db) return originalBreakdown;

        const chat = chatType === 'private'
            ? window.db.characters?.find(character => character.id === chatId)
            : window.db.groups?.find(group => group.id === chatId);

        if (!chat) return originalBreakdown;

        const adjustment = getImageTokenAdjustment(window.db, chat, chatType);
        if (adjustment.imageCount === 0) return originalBreakdown;

        const details = Array.isArray(originalBreakdown.details)
            ? originalBreakdown.details.map(detail => {
                if (detail.key !== 'shortTermMemory') return detail;

                return {
                    ...detail,
                    value: Math.max(0, detail.value + adjustment.delta),
                };
            })
            : originalBreakdown.details;

        return {
            ...originalBreakdown,
            total: Math.max(0, originalBreakdown.total + adjustment.delta),
            details,
        };
    }

    function patchedEstimateChatTokens(chatId, chatType = 'private') {
        const breakdown = patchedGetChatTokenBreakdown(chatId, chatType);
        return breakdown ? breakdown.total : 0;
    }

    window.getChatTokenBreakdown = patchedGetChatTokenBreakdown;
    window.estimateChatTokens = patchedEstimateChatTokens;
    window[PATCH_STATE_KEY] = Object.freeze({
        originalGetChatTokenBreakdown,
        originalEstimateChatTokens,
        imageVisualTokenEstimate: IMAGE_VISUAL_TOKEN_ESTIMATE,
    });

    console.info('[OVO custom] Image Token estimate patch loaded.');
}

installImageTokenEstimatePatch();
