const FORMAT = 'uwu-shared-journal-memory';
const VERSION = 1;
const RECENT_CONTEXT_FORMAT = 'uwu-recent-context';
const RECENT_CONTEXT_VERSION = 1;
const RECENT_CONTEXT_TURNS = 5;
const STORAGE_KEY = 'ovo.shared-memory-cloud.v1';
const SYNC_INTERVAL_MS = 60_000;

function normalizeCloudURL(value) {
    const url = String(value || '').trim().replace(/\/+$/, '');
    if (!url) throw new Error('请填写共享记忆地址');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        throw new Error('共享记忆地址必须使用 HTTPS');
    }
    return url;
}

function loadState(storage = localStorage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: false, cursor: 0, records: {} };
    const value = JSON.parse(raw);
    return {
        enabled: value.enabled === true,
        url: typeof value.url === 'string' ? value.url : '',
        token: typeof value.token === 'string' ? value.token : '',
        chatId: value.chatId ?? null,
        chatType: value.chatType === 'group' ? 'group' : 'private',
        cursor: Number.isSafeInteger(value.cursor) && value.cursor >= 0 ? value.cursor : 0,
        records: value.records && typeof value.records === 'object' ? value.records : {},
    };
}

function saveState(state, storage = localStorage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function sourceKey(sourceApp, sourceRecordId) {
    return `${sourceApp}\u0000${sourceRecordId}`;
}

function recentMessage(message) {
    if (!message || message.isContextDisabled || message.isThinking || message.isNodeBoundary) return null;
    const role = message.role === 'user'
        ? 'user'
        : message.role === 'assistant' || message.role === 'char'
            ? 'assistant'
            : null;
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!role || !content) return null;
    return {
        role,
        content,
        createdAt: timestamp(message.timestamp, null),
    };
}

function buildRecentContextMessages(history, turnLimit = RECENT_CONTEXT_TURNS) {
    const turns = [];
    let current = null;
    for (const rawMessage of history || []) {
        const message = recentMessage(rawMessage);
        if (!message) continue;
        if (message.role === 'user') {
            if (current?.assistants.length) turns.push(current);
            current = { user: message, assistants: [] };
        } else if (current) {
            current.assistants.push(message);
        }
    }
    if (current?.assistants.length) turns.push(current);
    return turns.slice(-turnLimit).flatMap(turn => [
        turn.user,
        {
            role: 'assistant',
            content: turn.assistants.map(message => message.content).join('\n'),
            createdAt: turn.assistants.at(-1)?.createdAt ?? null,
        },
    ]);
}

function recentSourceLabel(sourceApp) {
    if (sourceApp === 'uwu') return 'UwU';
    if (sourceApp === 'telegram') return 'TG';
    return sourceApp;
}

function buildCrossAppRecentContextPrompt(contexts) {
    const blocks = (contexts || []).map(context => {
        const messages = Array.isArray(context.messages) ? context.messages.slice(-RECENT_CONTEXT_TURNS * 2) : [];
        const transcript = messages.map(message => {
            const content = typeof message?.content === 'string' ? message.content.trim() : '';
            if (!content || !['user', 'assistant'].includes(message.role)) return '';
            return `${message.role === 'user' ? '用户' : '助手'}：${content}`;
        }).filter(Boolean).join('\n');
        return transcript ? `[${recentSourceLabel(context.sourceApp)} 最近对话]\n${transcript}` : '';
    }).filter(Boolean);
    if (!blocks.length) return '';
    return [
        '<cross_app_recent_context>',
        '以下是你和用户在其他软件中最近五轮对话的只读快照。',
        '它们只用于承接话题，不属于当前软件的聊天记录，不要把内容复制成当前聊天消息，也不要逐条复述。',
        '',
        blocks.join('\n\n'),
        '</cross_app_recent_context>',
    ].join('\n');
}

async function contentHash(title, content) {
    const bytes = new TextEncoder().encode(`${title}\u0000${content}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

function timestamp(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function sourceRange(journal) {
    const range = journal.sourceMessageRange || journal.range;
    const start = Number.isSafeInteger(range?.start) && range.start > 0 ? range.start : null;
    const end = Number.isSafeInteger(range?.end) && range.end >= start ? range.end : null;
    return start !== null && end !== null ? { start, end } : null;
}

async function buildSyncPlan(journals, state, binding, now = Date.now()) {
    const memories = [];
    const liveKeys = new Set();
    const journalsByKey = new Map();

    for (const journal of journals) {
        if (!journal?.isFavorited || !journal?.title?.trim() || !journal?.content?.trim()) continue;
        const sourceApp = journal.sourceApp || 'ovo';
        const sourceRecordId = journal.sourceRecordId
            || (sourceApp !== 'ovo' && journal.sharedMemoryId ? journal.sharedMemoryId : null)
            || `ovo:${binding.chatType}:${binding.chatId}:${journal.id}`;
        const key = sourceKey(sourceApp, sourceRecordId);
        const known = state.records[key];
        const hash = await contentHash(journal.title.trim(), journal.content.trim());
        const changed = Boolean(known && (known.deletedAt || known.hash !== hash));
        const createdAt = timestamp(journal.createdAt, timestamp(known?.createdAt, now));
        const baseUpdatedAt = timestamp(
            journal.sharedUpdatedAt ?? journal.updatedAt,
            timestamp(known?.updatedAt, createdAt),
        );
        const updatedAt = changed ? Math.max(now, baseUpdatedAt + 1) : baseUpdatedAt;
        const range = sourceRange(journal);

        journal.sourceApp = sourceApp;
        journal.sourceRecordId = sourceRecordId;
        journal.sharedUpdatedAt = updatedAt;
        journal.sharedContentHash = hash;
        liveKeys.add(key);
        journalsByKey.set(key, journal);
        if (!known || changed) {
            memories.push({
                id: journal.sharedMemoryId || journal.id,
                title: journal.title.trim(),
                content: journal.content.trim(),
                sourceApp,
                sourceRecordId,
                sourceChatId: journal.sourceChatId ?? journal.chatId ?? binding.chatId,
                startMessageSeq: range?.start ?? null,
                endMessageSeq: range?.end ?? null,
                createdAt,
                updatedAt,
                deletedAt: null,
            });
        }
    }

    for (const [key, known] of Object.entries(state.records)) {
        if (liveKeys.has(key) || known.deletedAt) continue;
        memories.push({
            id: known.id,
            sourceApp: known.sourceApp,
            sourceRecordId: known.sourceRecordId,
            updatedAt: Math.max(now, timestamp(known.updatedAt, 0) + 1),
            deletedAt: Math.max(now, timestamp(known.updatedAt, 0) + 1),
        });
    }

    return { memories, journalsByKey };
}

async function mergePulledMemories(journals, memories, state) {
    let changed = false;
    for (const memory of memories) {
        const key = sourceKey(memory.sourceApp, memory.sourceRecordId);
        const known = state.records[key];
        const index = journals.findIndex(journal => (
            journal.sharedMemoryId === memory.id
            || (journal.sourceApp === memory.sourceApp && journal.sourceRecordId === memory.sourceRecordId)
        ));

        if (memory.deletedAt) {
            if (index !== -1 && journals[index].isFavorited) {
                journals.splice(index, 1);
                changed = true;
            }
            state.records[key] = {
                id: memory.id,
                sourceApp: memory.sourceApp,
                sourceRecordId: memory.sourceRecordId,
                updatedAt: memory.updatedAt,
                deletedAt: memory.deletedAt,
                hash: known?.hash || null,
                createdAt: known?.createdAt || memory.createdAt,
            };
            continue;
        }

        const hash = await contentHash(memory.title, memory.content);
        const existing = index === -1 ? null : journals[index];
        if (!existing) {
            journals.push({
                id: `journal_cloud_${memory.id}`,
                range: { start: 0, end: 0 },
                sourceMessageRange: memory.startMessageSeq && memory.endMessageSeq
                    ? { start: memory.startMessageSeq, end: memory.endMessageSeq }
                    : null,
                title: memory.title,
                content: memory.content,
                createdAt: memory.createdAt,
                updatedAt: memory.updatedAt,
                isFavorited: true,
                sourceApp: memory.sourceApp,
                sourceRecordId: memory.sourceRecordId,
                sourceChatId: memory.sourceChatId,
                sharedMemoryId: memory.id,
                sharedUpdatedAt: memory.updatedAt,
                sharedContentHash: hash,
                sharedMirror: true,
            });
            changed = true;
        } else if (memory.updatedAt > timestamp(existing.sharedUpdatedAt, 0)) {
            existing.title = memory.title;
            existing.content = memory.content;
            existing.updatedAt = memory.updatedAt;
            existing.sourceApp = memory.sourceApp;
            existing.sourceRecordId = memory.sourceRecordId;
            existing.sourceChatId = memory.sourceChatId;
            existing.sharedMemoryId = memory.id;
            existing.sharedUpdatedAt = memory.updatedAt;
            existing.sharedContentHash = hash;
            if (memory.sourceApp !== 'ovo') {
                existing.range = { start: 0, end: 0 };
                existing.sourceMessageRange = memory.startMessageSeq && memory.endMessageSeq
                    ? { start: memory.startMessageSeq, end: memory.endMessageSeq }
                    : null;
            }
            changed = true;
        }

        state.records[key] = {
            id: memory.id,
            sourceApp: memory.sourceApp,
            sourceRecordId: memory.sourceRecordId,
            updatedAt: memory.updatedAt,
            deletedAt: null,
            hash,
            createdAt: memory.createdAt,
        };
    }
    return changed;
}

function boundChat(state) {
    const list = state.chatType === 'group' ? window.db?.groups : window.db?.characters;
    const chat = list?.find(item => String(item.id) === String(state.chatId));
    if (!chat) throw new Error('绑定的角色不存在，请在目标角色的回忆日记里重新连接');
    if (!Array.isArray(chat.memoryJournals)) chat.memoryJournals = [];
    return chat;
}

async function saveBoundChat(state) {
    const save = state.chatType === 'group' ? window.saveGroup : window.saveCharacter;
    if (typeof save !== 'function') throw new Error('当前版本缺少日记保存接口');
    await save(state.chatId);
}

async function requestCloud(state, path, init = {}) {
    const response = await fetch(`${state.url}${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${state.token}`,
            'content-type': 'application/json',
            ...init.headers,
        },
    });
    if (!response.ok) throw new Error(`共享记忆请求失败：HTTP ${response.status}`);
    return response.json();
}

function stateMatchesChat(state, chat, chatType) {
    return state.enabled
        && state.url
        && state.token
        && state.chatType === chatType
        && String(state.chatId) === String(chat?.id);
}

async function publishRecentContext(chat, chatType, state = loadState()) {
    if (!stateMatchesChat(state, chat, chatType)) return null;
    state.url = normalizeCloudURL(state.url);
    return requestCloud(state, '/v1/recent-context', {
        method: 'POST',
        body: JSON.stringify({
            format: RECENT_CONTEXT_FORMAT,
            version: RECENT_CONTEXT_VERSION,
            sourceApp: 'uwu',
            sourceChatId: String(chat.id),
            messages: buildRecentContextMessages(chat.history),
        }),
    });
}

async function refreshRecentContext(chat, chatType, state = loadState()) {
    if (!stateMatchesChat(state, chat, chatType)) return '';
    state.url = normalizeCloudURL(state.url);
    const [, pulled] = await Promise.all([
        publishRecentContext(chat, chatType, state),
        requestCloud(state, '/v1/recent-context?exclude=uwu'),
    ]);
    if (pulled.format !== RECENT_CONTEXT_FORMAT || pulled.version !== RECENT_CONTEXT_VERSION) {
        throw new Error('云端近期上下文版本不兼容');
    }
    return buildCrossAppRecentContextPrompt(pulled.contexts);
}

let syncing = null;

async function syncNow(storage = localStorage) {
    if (syncing) return syncing;
    syncing = (async () => {
        const state = loadState(storage);
        if (!state.enabled) throw new Error('共享记忆还没有启用');
        state.url = normalizeCloudURL(state.url);
        if (!state.token) throw new Error('请填写共享记忆令牌');
        const chat = boundChat(state);
        const binding = { chatId: state.chatId, chatType: state.chatType };
        const plan = await buildSyncPlan(chat.memoryJournals, state, binding);
        const pushed = await requestCloud(state, '/v1/memories/sync', {
            method: 'POST',
            body: JSON.stringify({ format: FORMAT, version: VERSION, memories: plan.memories }),
        });

        for (const record of pushed.records || []) {
            const key = sourceKey(record.sourceApp, record.sourceRecordId);
            const journal = plan.journalsByKey.get(key);
            if (journal && record.id) {
                journal.sharedMemoryId = record.id;
                journal.sourceApp = record.canonicalSourceApp || record.sourceApp;
                journal.sourceRecordId = record.canonicalSourceRecordId || record.sourceRecordId;
                const canonicalKey = sourceKey(journal.sourceApp, journal.sourceRecordId);
                if (canonicalKey !== key && state.records[key]) {
                    state.records[key].deletedAt = record.updatedAt;
                }
                state.records[canonicalKey] = {
                    id: record.id,
                    sourceApp: journal.sourceApp,
                    sourceRecordId: journal.sourceRecordId,
                    updatedAt: record.updatedAt,
                    deletedAt: null,
                    hash: journal.sharedContentHash,
                    createdAt: journal.createdAt,
                };
            }
        }

        const pulled = await requestCloud(state, `/v1/memories?after=${state.cursor || 0}`);
        const changed = await mergePulledMemories(chat.memoryJournals, pulled.memories || [], state);
        state.cursor = pulled.cursor || state.cursor || 0;
        saveState(state, storage);
        await saveBoundChat(state);
        await publishRecentContext(chat, state.chatType, state);
        if (changed) window.renderJournalList?.();
        return {
            pushed,
            pulled: pulled.memories?.length || 0,
            cursor: state.cursor,
        };
    })().finally(() => {
        syncing = null;
    });
    return syncing;
}

function modalMarkup() {
    return `
        <div class="modal-window">
            <h3>共享记忆</h3>
            <p style="font-size:12px;color:#888;line-height:1.5;margin:0 0 14px;">当前角色已收藏的日记会与 TG 使用同一个云端记忆库；最近 5 轮对话会作为滚动快照供其他软件承接话题，不生成对方的聊天气泡。未收藏日记不会上传。</p>
            <div class="form-group">
                <label for="shared-memory-cloud-url">云端地址</label>
                <input id="shared-memory-cloud-url" type="url" placeholder="https://...workers.dev">
            </div>
            <div class="form-group">
                <label for="shared-memory-cloud-token">同步令牌</label>
                <input id="shared-memory-cloud-token" type="password" autocomplete="new-password">
            </div>
            <label style="display:flex;align-items:center;justify-content:space-between;margin:14px 0;">
                <span>自动同步</span>
                <input id="shared-memory-cloud-enabled" type="checkbox" checked>
            </label>
            <p id="shared-memory-cloud-status" style="font-size:12px;color:#888;min-height:18px;"></p>
            <div style="display:flex;gap:10px;">
                <button type="button" class="btn btn-neutral" id="shared-memory-cloud-cancel" style="flex:1;">取消</button>
                <button type="button" class="btn btn-primary" id="shared-memory-cloud-save" style="flex:1;">连接并同步</button>
            </div>
        </div>`;
}

function setupUI() {
    const actionSheet = document.querySelector('#journal-title-actionsheet .action-sheet');
    const cancel = document.getElementById('journal-title-cancel-btn');
    if (!actionSheet || !cancel || document.getElementById('shared-memory-cloud-open')) return;

    const open = document.createElement('button');
    open.type = 'button';
    open.id = 'shared-memory-cloud-open';
    open.className = 'action-sheet-button';
    open.textContent = '共享记忆同步';
    actionSheet.insertBefore(open, cancel);

    const modal = document.createElement('div');
    modal.id = 'shared-memory-cloud-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = modalMarkup();
    document.body.appendChild(modal);

    const urlInput = modal.querySelector('#shared-memory-cloud-url');
    const tokenInput = modal.querySelector('#shared-memory-cloud-token');
    const enabledInput = modal.querySelector('#shared-memory-cloud-enabled');
    const status = modal.querySelector('#shared-memory-cloud-status');

    open.addEventListener('click', () => {
        document.getElementById('journal-title-actionsheet')?.classList.remove('visible');
        const state = loadState();
        urlInput.value = state.url || '';
        tokenInput.value = state.token || '';
        enabledInput.checked = state.enabled;
        status.textContent = state.cursor ? `已同步到版本 ${state.cursor}` : '';
        modal.classList.add('visible');
    });
    modal.querySelector('#shared-memory-cloud-cancel').addEventListener('click', () => modal.classList.remove('visible'));
    modal.querySelector('#shared-memory-cloud-save').addEventListener('click', async () => {
        try {
            const chatId = window.currentChatId;
            const chatType = window.currentChatType;
            if (chatId == null || !['private', 'group'].includes(chatType)) {
                throw new Error('请从目标角色的回忆日记页面打开此设置');
            }
            const previous = loadState();
            const url = normalizeCloudURL(urlInput.value);
            const token = tokenInput.value.trim();
            if (!token) throw new Error('请填写共享记忆令牌');
            const bindingChanged = String(previous.chatId) !== String(chatId)
                || previous.chatType !== chatType
                || previous.url !== url
                || previous.token !== token;
            const next = {
                enabled: enabledInput.checked,
                url,
                token,
                chatId,
                chatType,
                cursor: bindingChanged ? 0 : previous.cursor,
                records: bindingChanged ? {} : previous.records,
            };
            saveState(next);
            if (!next.enabled) {
                status.textContent = '自动同步已关闭';
                window.showToast?.('共享记忆自动同步已关闭');
                modal.classList.remove('visible');
                return;
            }
            status.textContent = '正在同步…';
            const result = await syncNow();
            status.textContent = `同步完成，云端版本 ${result.cursor}`;
            window.showToast?.(`共享记忆同步完成：收到 ${result.pulled} 条变化`);
            modal.classList.remove('visible');
        } catch (error) {
            status.textContent = error.message;
        }
    });
}

function scheduleAutomaticSync() {
    const run = () => {
        const state = loadState();
        if (!state.enabled || !navigator.onLine) return;
        syncNow().catch(error => console.error('[OVO shared memory] Sync failed:', error));
    };
    window.addEventListener('online', run);
    setInterval(run, SYNC_INTERVAL_MS);
    setTimeout(run, 1500);
}

if (typeof document !== 'undefined') {
    setupUI();
    scheduleAutomaticSync();
    window.ovoSharedMemorySyncNow = syncNow;
    window.UwUCrossAppContext = {
        publish: publishRecentContext,
        refresh: refreshRecentContext,
    };
}

export {
    buildCrossAppRecentContextPrompt,
    buildRecentContextMessages,
    buildSyncPlan,
    loadState,
    mergePulledMemories,
    normalizeCloudURL,
    sourceKey,
};
