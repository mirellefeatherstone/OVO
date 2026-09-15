import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
    new URL('../js/shared-memory-cloud.js', import.meta.url),
    'utf8',
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
    buildCrossAppRecentContextPrompt,
    buildRecentContextMessages,
    buildSyncPlan,
    loadState,
    mergePulledMemories,
    normalizeCloudURL,
    sourceKey,
} = await import(moduleUrl);

test('recent context keeps five complete rounds and merges reply bubbles', () => {
    const history = [];
    for (let turn = 1; turn <= 6; turn += 1) {
        history.push({ role: 'user', content: `用户-${turn}`, timestamp: turn * 10 });
        history.push({ role: 'assistant', content: `回复-${turn}-a`, timestamp: turn * 10 + 1 });
        history.push({ role: 'assistant', content: `回复-${turn}-b`, timestamp: turn * 10 + 2 });
    }
    history.push({ role: 'user', content: '尚未回复', timestamp: 100 });
    history.push({ role: 'assistant', content: '隐藏思考', isThinking: true, timestamp: 101 });

    const messages = buildRecentContextMessages(history);
    assert.equal(messages.length, 10);
    assert.equal(messages[0].content, '用户-2');
    assert.equal(messages[1].content, '回复-2-a\n回复-2-b');
    assert.equal(messages.at(-1).content, '回复-6-a\n回复-6-b');
    assert.equal(messages.some(message => message.content === '尚未回复'), false);
});

test('cross-app context is a read-only prompt instead of local chat history', () => {
    const prompt = buildCrossAppRecentContextPrompt([{
        sourceApp: 'telegram',
        messages: [
            { role: 'user', content: '刚才聊到奶蛙。' },
            { role: 'assistant', content: '记得，继续说。' },
        ],
    }]);
    assert.match(prompt, /TG 最近对话/);
    assert.match(prompt, /只读快照/);
    assert.match(prompt, /刚才聊到奶蛙/);
});

test('cloud URL requires HTTPS outside local development', () => {
    assert.equal(normalizeCloudURL('https://memory.example.test/'), 'https://memory.example.test');
    assert.equal(normalizeCloudURL('http://127.0.0.1:8791'), 'http://127.0.0.1:8791');
    assert.throws(() => normalizeCloudURL('http://memory.example.test'), /HTTPS/);
});

test('local journals keep one stable source identity across syncs', async () => {
    const journals = [{
        id: 'journal_1',
        title: 'OVO 的一天',
        content: '日记正文',
        range: { start: 1, end: 150 },
        createdAt: 1000,
        isFavorited: true,
    }];
    const state = { records: {} };
    const binding = { chatId: 'char-1', chatType: 'private' };
    const first = await buildSyncPlan(journals, state, binding, 2000);
    assert.equal(first.memories.length, 1);
    assert.equal(first.memories[0].sourceApp, 'ovo');
    assert.equal(first.memories[0].sourceRecordId, 'ovo:private:char-1:journal_1');

    const key = sourceKey('ovo', 'ovo:private:char-1:journal_1');
    state.records[key] = {
        id: 'cloud-1',
        sourceApp: 'ovo',
        sourceRecordId: 'ovo:private:char-1:journal_1',
        hash: journals[0].sharedContentHash,
        updatedAt: journals[0].sharedUpdatedAt,
        createdAt: 1000,
        deletedAt: null,
    };
    const second = await buildSyncPlan(journals, state, binding, 3000);
    assert.equal(second.memories.length, 0);
});

test('only favorited journals enter shared memory', async () => {
    const journals = [{
        id: 'journal_private',
        title: '本地日记',
        content: '没有收藏，所以只留在 OVO。',
        createdAt: 1000,
        isFavorited: false,
    }];
    const plan = await buildSyncPlan(
        journals,
        { records: {} },
        { chatId: 'char-1', chatType: 'private' },
        2000,
    );
    assert.deepEqual(plan.memories, []);
});

test('unfavoriting removes the cloud copy but keeps the local journal', async () => {
    const journals = [{
        id: 'journal_1',
        title: '本地日记',
        content: '取消收藏后仍留在 OVO。',
        createdAt: 1000,
        isFavorited: false,
        sourceApp: 'ovo',
        sourceRecordId: 'ovo:private:char-1:journal_1',
        sharedMemoryId: 'cloud-1',
        sharedUpdatedAt: 1000,
    }];
    const key = sourceKey('ovo', 'ovo:private:char-1:journal_1');
    const state = { records: { [key]: {
        id: 'cloud-1',
        sourceApp: 'ovo',
        sourceRecordId: 'ovo:private:char-1:journal_1',
        hash: 'old-hash',
        updatedAt: 1000,
        createdAt: 1000,
        deletedAt: null,
    } } };
    const binding = { chatId: 'char-1', chatType: 'private' };
    const removal = await buildSyncPlan(journals, state, binding, 2000);
    assert.equal(removal.memories[0].deletedAt, 2000);

    assert.equal(await mergePulledMemories(journals, removal.memories, state), false);
    assert.equal(journals.length, 1);
    assert.equal(journals[0].isFavorited, false);

    journals[0].isFavorited = true;
    const restore = await buildSyncPlan(journals, state, binding, 3000);
    assert.equal(restore.memories.length, 1);
    assert.equal(restore.memories[0].deletedAt, null);
    assert.ok(restore.memories[0].updatedAt > 2000);
});

test('pulled records update in place and tombstones remove the same journal', async () => {
    const journals = [];
    const state = { records: {} };
    const base = {
        id: 'cloud-tg-1',
        title: 'TG 日记',
        content: '第一次正文',
        sourceApp: 'telegram',
        sourceRecordId: 'chat:1:1-150',
        sourceChatId: '1',
        startMessageSeq: 1,
        endMessageSeq: 150,
        createdAt: 1000,
        updatedAt: 1000,
        deletedAt: null,
    };
    assert.equal(await mergePulledMemories(journals, [base], state), true);
    assert.equal(journals.length, 1);
    assert.deepEqual(journals[0].range, { start: 0, end: 0 });
    assert.deepEqual(journals[0].sourceMessageRange, { start: 1, end: 150 });

    assert.equal(await mergePulledMemories(journals, [{
        ...base,
        content: '更新后的正文',
        updatedAt: 2000,
    }], state), true);
    assert.equal(journals.length, 1);
    assert.equal(journals[0].content, '更新后的正文');

    assert.equal(await mergePulledMemories(journals, [{
        ...base,
        content: '更新后的正文',
        updatedAt: 3000,
        deletedAt: 3000,
    }], state), true);
    assert.equal(journals.length, 0);
});

test('a removed OVO journal becomes one compact tombstone', async () => {
    const key = sourceKey('ovo', 'ovo:private:char-1:journal_1');
    const state = {
        records: {
            [key]: {
                id: 'cloud-1',
                sourceApp: 'ovo',
                sourceRecordId: 'ovo:private:char-1:journal_1',
                hash: 'old',
                updatedAt: 1000,
                createdAt: 1000,
                deletedAt: null,
            },
        },
    };
    const plan = await buildSyncPlan([], state, { chatId: 'char-1', chatType: 'private' }, 2000);
    assert.deepEqual(plan.memories, [{
        id: 'cloud-1',
        sourceApp: 'ovo',
        sourceRecordId: 'ovo:private:char-1:journal_1',
        updatedAt: 2000,
        deletedAt: 2000,
    }]);
});

test('cloud settings keep the sync token outside journal exports', () => {
    const storage = {
        getItem: () => JSON.stringify({
            enabled: true,
            url: 'https://memory.example.test',
            token: 'private-token',
            cursor: 8,
            records: {},
        }),
    };
    const state = loadState(storage);
    assert.equal(state.token, 'private-token');
    assert.equal(state.cursor, 8);
});
