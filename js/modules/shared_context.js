(function () {
    const MAX_RECORDS = 12;
    const MAX_NAME_MATCHES = 6;
    let records = [];
    let readyPromise;
    let settingsInitialized = false;

    function settings() {
        return db.sharedContextSettings;
    }

    function isEnabled() {
        return settings().enabled;
    }

    function table() {
        return dexieDB.sharedContextRecords;
    }

    function newestFirst(list) {
        return list.slice().sort((a, b) =>
            new Date(b.time).getTime() - new Date(a.time).getTime()
        );
    }

    async function init() {
        if (!readyPromise) {
            readyPromise = table().toArray().then(saved => {
                records = newestFirst(saved);
            });
        }
        await readyPromise;
    }

    async function importRecords(incoming) {
        await init();
        const unique = Array.from(
            new Map(incoming.map(record => [record.id, record])).values()
        );
        await table().bulkPut(unique);
        records = newestFirst(await table().toArray());
        return unique.length;
    }

    async function getRecords() {
        await init();
        return records.map(record => ({ ...record }));
    }

    function characterNames(character) {
        return [
            character.realName,
            character.remarkName,
            ...(character.aliases || [])
        ].filter(Boolean).map(name => name.toLowerCase());
    }

    function selectRecords(character) {
        const recent = records.slice(0, 40);
        const names = characterNames(character);
        const matched = recent.filter(record => {
            const text = `${record.content}\n${record.quote || ''}`.toLowerCase();
            return names.some(name => text.includes(name));
        }).slice(0, MAX_NAME_MATCHES);
        const matchedIds = new Set(matched.map(record => record.id));
        const general = recent
            .filter(record => !matchedIds.has(record.id))
            .slice(0, MAX_RECORDS - matched.length);
        return newestFirst(matched.concat(general)).slice(0, MAX_RECORDS);
    }

    function getContextForCharacter(character) {
        if (!isEnabled()) return '';
        const selected = selectRecords(character);
        if (!selected.length) return '';

        const recordText = selected.map(record => [
            `时间：${record.time}`,
            `来源：${record.source}`,
            `类型：${record.kind}`,
            `内容：${record.content}`,
            record.quote ? `原话：${record.quote}` : ''
        ].filter(Boolean).join('\n')).join('\n\n');

        return `<shared_context>
以下内容来自米莉在其他地方留下的真实谈话、经历、想法或观点。
这些内容不是米莉在当前聊天中说的话，也不一定曾直接告诉过你。
来源和时间属于事实的一部分。
你可以自然地知道这些事情，并根据自己的人格和当前关系自行理解。
不要为了证明自己知道而逐条复述。
不要把外部谈话伪装成你亲历的对话，也不要声称米莉曾经直接对你说过这些内容。

${recordText}
</shared_context>`;
    }

    async function remove(id) {
        await init();
        await table().delete(id);
        records = records.filter(record => record.id !== id);
    }

    async function clear() {
        await init();
        await table().clear();
        records = [];
    }

    async function setEnabled(enabled) {
        settings().enabled = enabled;
        await saveGlobalSettings();
    }

    function setupSettings() {
        if (settingsInitialized) return;
        settingsInitialized = true;
        const toggle = document.getElementById('shared-context-enabled');
        toggle.checked = isEnabled();
        toggle.addEventListener('change', async () => {
            await setEnabled(toggle.checked);
            showToast(toggle.checked ? 'Shared Context 已开启' : 'Shared Context 已关闭');
        });
    }

    window.UwUSharedContext = {
        init,
        importRecords,
        getRecords,
        getContextForCharacter,
        remove,
        clear,
        isEnabled,
        setEnabled,
        setupSettings
    };
})();
