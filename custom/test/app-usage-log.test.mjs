import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
    new URL('../../js/app_usage.js', import.meta.url),
    'utf8',
);
const context = {
    console,
    document: {
        addEventListener() {},
        visibilityState: 'visible',
    },
    localStorage: {
        getItem() { return null; },
        removeItem() {},
        setItem() {},
    },
    window: {},
};

vm.runInNewContext(source, context);
const usage = context.window.UwUAppUsage;

test('AppUsage keeps complete JSONL records and identifies fragments', () => {
    const result = usage.parseEventText([
        '{"appName":"Safari","action":"open","timestampMs":1000}',
        'pen"}',
        '{"appName":"Safari","action":"close","timestampMs":2000}',
        '',
    ].join('\n'));

    assert.equal(result.events.length, 2);
    assert.equal(result.events[0].action, 'open');
    assert.equal(result.events[1].action, 'close');
    assert.deepEqual(
        JSON.parse(JSON.stringify(result.malformed)),
        [{ lineNumber: 2, length: 5 }],
    );
});
