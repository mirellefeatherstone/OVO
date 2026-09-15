import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
    new URL('../js/shared-memory-journal.js', import.meta.url),
    'utf8',
);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const {
    importNativeJournals,
    mergeSharedMemories,
    normalizeSharedMemoryPackage,
} = await import(moduleUrl);

function memoryPackage(overrides = {}) {
    return {
        format: 'uwu-shared-journal-memory',
        version: 1,
        memories: [{
            id: 'mem_123',
            title: '来自 TG 的日记',
            content: '我们在 Telegram 里聊过奶蛙。',
            sourceApp: 'telegram',
            sourceRecordId: 'mem_123',
            sourceChatId: '12',
            startMessageSeq: 1,
            endMessageSeq: 150,
            createdAt: 1000,
            updatedAt: 1000,
            ...overrides,
        }],
    };
}

test('normalizes the shared package without transcript data', () => {
    assert.deepEqual(normalizeSharedMemoryPackage(memoryPackage()), [{
        id: 'mem_123',
        title: '来自 TG 的日记',
        content: '我们在 Telegram 里聊过奶蛙。',
        sourceApp: 'telegram',
        sourceRecordId: 'mem_123',
        sourceChatId: '12',
        startMessageSeq: 1,
        endMessageSeq: 150,
        createdAt: 1000,
        updatedAt: 1000,
    }]);
});

test('imports, deduplicates and updates shared memories by stable id', () => {
    const journals = [];
    const first = normalizeSharedMemoryPackage(memoryPackage());
    assert.deepEqual(
        mergeSharedMemories(journals, first, { chatId: 'ovo-1', chatType: 'private' }),
        { imported: 1, updated: 0, skipped: 0 },
    );
    assert.equal(journals[0].sharedMemoryId, 'mem_123');
    assert.deepEqual(journals[0].range, { start: 0, end: 0 });
    assert.deepEqual(journals[0].sourceMessageRange, { start: 1, end: 150 });
    assert.deepEqual(
        mergeSharedMemories(journals, first, { chatId: 'ovo-1', chatType: 'private' }),
        { imported: 0, updated: 0, skipped: 1 },
    );

    const newer = normalizeSharedMemoryPackage(memoryPackage({
        title: '更新后的 TG 日记',
        content: '我们后来又补充了奶蛙的事情。',
        updatedAt: 2000,
    }));
    assert.deepEqual(
        mergeSharedMemories(journals, newer, { chatId: 'ovo-1', chatType: 'private' }),
        { imported: 0, updated: 1, skipped: 0 },
    );
    assert.equal(journals[0].title, '更新后的 TG 日记');
    assert.equal(journals[0].content, '我们后来又补充了奶蛙的事情。');
});

test('keeps OVO native array import behavior', () => {
    const journals = [];
    const imported = importNativeJournals(journals, [{
        id: 'old-id',
        range: { start: 10, end: 20 },
        title: '原生日记',
        content: '原生正文',
        createdAt: 1000,
        isFavorited: true,
        isNodeSummary: true,
        nodeId: 'node-1',
    }], { chatId: 'ovo-1', chatType: 'private' });

    assert.equal(imported, 1);
    assert.match(journals[0].id, /^journal_imp_/);
    assert.deepEqual(journals[0].range, { start: 10, end: 20 });
    assert.equal(journals[0].isFavorited, true);
    assert.equal(journals[0].isNodeSummary, true);
    assert.equal(journals[0].nodeId, 'node-1');
});
