const SHARED_MEMORY_FORMAT = 'uwu-shared-journal-memory';
const SHARED_MEMORY_VERSION = 1;
const JOURNAL_IMPORT_INPUT_ID = 'import-journal-file-input';

function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function timestamp(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function memoryId(value, index) {
    const id = typeof value === 'string' ? value.trim() : '';
    return id || `shared_memory_${Date.now()}_${index}`;
}

function normalizeSharedMemoryPackage(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || value.format !== SHARED_MEMORY_FORMAT
        || value.version !== SHARED_MEMORY_VERSION
        || !Array.isArray(value.memories)) {
        throw new Error('不是受支持的 TG/uwu 共享记忆包');
    }

    const now = Date.now();
    return value.memories.map((item, index) => {
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        const content = typeof item?.content === 'string' ? item.content.trim() : '';
        if (!title || !content) throw new Error(`第 ${index + 1} 条记忆缺少标题或正文`);
        const createdAt = timestamp(item.createdAt, now);
        const updatedAt = Math.max(timestamp(item.updatedAt, createdAt), createdAt);
        const start = positiveInteger(item.startMessageSeq);
        const end = positiveInteger(item.endMessageSeq);
        const validRange = start !== null && end !== null && start <= end;
        return {
            id: memoryId(item.id, index),
            title,
            content,
            sourceApp: typeof item.sourceApp === 'string' && item.sourceApp.trim()
                ? item.sourceApp.trim()
                : 'telegram',
            sourceRecordId: typeof item.sourceRecordId === 'string' && item.sourceRecordId.trim()
                ? item.sourceRecordId.trim()
                : memoryId(item.id, index),
            sourceChatId: item.sourceChatId === null || item.sourceChatId === undefined
                ? null
                : String(item.sourceChatId),
            startMessageSeq: validRange ? start : null,
            endMessageSeq: validRange ? end : null,
            createdAt,
            updatedAt,
        };
    });
}

function sameRange(journal, memory) {
    const sourceRange = journal.sourceMessageRange;
    return (journal.sourceApp === memory.sourceApp && journal.sourceRecordId === memory.sourceRecordId)
        || (journal.sourceApp === memory.sourceApp
            && journal.sourceChatId === memory.sourceChatId
            && sourceRange?.start === memory.startMessageSeq
            && sourceRange?.end === memory.endMessageSeq);
}

function mergeSharedMemories(journals, memories, { chatId, chatType }) {
    const result = { imported: 0, updated: 0, skipped: 0 };

    memories.forEach((memory, index) => {
        const existing = journals.find(journal => (
            journal.sharedMemoryId === memory.id
            || journal.id === memory.id
            || sameRange(journal, memory)
        ));
        if (existing) {
            const existingUpdatedAt = timestamp(
                existing.sharedUpdatedAt ?? existing.updatedAt,
                timestamp(existing.createdAt, 0),
            );
            if (memory.updatedAt <= existingUpdatedAt) {
                result.skipped += 1;
                return;
            }
            existing.title = memory.title;
            existing.content = memory.content;
            existing.range = { start: 0, end: 0 };
            existing.sourceMessageRange = memory.startMessageSeq === null
                ? null
                : { start: memory.startMessageSeq, end: memory.endMessageSeq };
            existing.sourceApp = memory.sourceApp;
            existing.sourceRecordId = memory.sourceRecordId;
            existing.sourceChatId = memory.sourceChatId;
            existing.sharedMemoryId = memory.id;
            existing.sharedUpdatedAt = memory.updatedAt;
            existing.updatedAt = memory.updatedAt;
            result.updated += 1;
            return;
        }

        if (journals.some(journal => journal.content?.trim() === memory.content)) {
            result.skipped += 1;
            return;
        }

        const id = journals.some(journal => journal.id === memory.id)
            ? `journal_shared_${Date.now()}_${index}`
            : memory.id;
        journals.push({
            id,
            range: { start: 0, end: 0 },
            sourceMessageRange: memory.startMessageSeq === null
                ? null
                : { start: memory.startMessageSeq, end: memory.endMessageSeq },
            title: memory.title,
            content: memory.content,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt,
            chatId,
            chatType,
            isFavorited: false,
            sourceApp: memory.sourceApp,
            sourceRecordId: memory.sourceRecordId,
            sourceChatId: memory.sourceChatId,
            sharedMemoryId: memory.id,
            sharedUpdatedAt: memory.updatedAt,
        });
        result.imported += 1;
    });

    return result;
}

function importNativeJournals(journals, items, { chatId, chatType }) {
    let imported = 0;
    items.forEach(item => {
        if (!item?.title || !item?.content) return;
        const journal = {
            id: `journal_imp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            range: item.range || { start: 0, end: 0 },
            title: item.title,
            content: item.content,
            createdAt: item.createdAt || Date.now(),
            chatId,
            chatType,
            isFavorited: !!item.isFavorited,
        };
        if (item.isNodeSummary) {
            journal.isNodeSummary = true;
            journal.nodeId = item.nodeId || `node_imp_${Date.now()}`;
        }
        journals.push(journal);
        imported += 1;
    });
    return imported;
}

function getCurrentChat() {
    const chatType = window.currentChatType;
    const chatId = window.currentChatId;
    const collection = chatType === 'private' ? window.db?.characters : window.db?.groups;
    const chat = collection?.find(item => item.id === chatId);
    if (!chat) throw new Error('请先进入一个角色或群聊');
    if (!Array.isArray(chat.memoryJournals)) chat.memoryJournals = [];
    return { chat, chatId, chatType };
}

async function saveCurrentChat(chatId, chatType) {
    const save = chatType === 'private' ? window.saveCharacter : window.saveGroup;
    if (typeof save !== 'function') throw new Error('当前版本缺少日记保存接口');
    await save(chatId);
}

async function handleJournalImport(event) {
    // The author importer only accepts arrays, so this capture listener routes
    // both formats once and prevents the later array-only handler from duplicating them.
    event.stopImmediatePropagation();
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
        const value = JSON.parse(await file.text());
        const { chat, chatId, chatType } = getCurrentChat();
        let message;
        if (Array.isArray(value)) {
            const imported = importNativeJournals(chat.memoryJournals, value, { chatId, chatType });
            if (!imported) throw new Error('未在文件中找到有效的日记数据');
            message = `成功导入 ${imported} 篇日记`;
        } else {
            const memories = normalizeSharedMemoryPackage(value);
            const result = mergeSharedMemories(chat.memoryJournals, memories, { chatId, chatType });
            message = `共享记忆：新增 ${result.imported}，更新 ${result.updated}，跳过 ${result.skipped}`;
        }
        await saveCurrentChat(chatId, chatType);
        window.renderJournalList?.();
        window.showToast?.(message);
    } catch (error) {
        console.error('[OVO shared memory] Import failed:', error);
        window.showToast?.(`导入失败：${error.message}`);
    }
}

function setupSharedMemoryJournalImport() {
    const input = document.getElementById(JOURNAL_IMPORT_INPUT_ID);
    if (!input || input.dataset.ovoSharedMemoryImport === 'ready') return;
    input.dataset.ovoSharedMemoryImport = 'ready';
    input.addEventListener('change', handleJournalImport, { capture: true });
}

if (typeof document !== 'undefined') setupSharedMemoryJournalImport();

export {
    importNativeJournals,
    mergeSharedMemories,
    normalizeSharedMemoryPackage,
};
