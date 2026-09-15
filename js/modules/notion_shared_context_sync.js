(function () {
    const NOTION_VERSION = '2026-03-11';
    let initialized = false;
    let syncInFlight = null;

    function settings() {
        return db.notionSharedContextSettings;
    }

    function propertyText(property) {
        if (!property) return '';
        if (property.type === 'date') return property.date?.start || '';
        if (property.type === 'select') return property.select?.name || '';
        if (property.type === 'status') return property.status?.name || '';
        const parts = property[property.type];
        return Array.isArray(parts)
            ? parts.map(part => part.plain_text || '').join('')
            : '';
    }

    function mapPage(page) {
        const properties = page.properties;
        return {
            id: propertyText(properties['Record ID']),
            time: propertyText(properties.Time),
            source: propertyText(properties.Source),
            kind: propertyText(properties.Kind),
            content: propertyText(properties.Content),
            quote: propertyText(properties.Quote)
        };
    }

    async function queryPages(config) {
        const pages = [];
        let cursor = null;

        do {
            const data = {
                page_size: 100,
                sorts: [{ property: 'Time', direction: 'ascending' }]
            };
            if (config.lastSyncTime) {
                data.filter = {
                    property: 'Time',
                    date: { on_or_after: config.lastSyncTime }
                };
            }
            if (cursor) data.start_cursor = cursor;

            const response = await window.Capacitor.Plugins.CapacitorHttp.post({
                url: `https://api.notion.com/v1/data_sources/${config.dataSourceId}/query`,
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    'Notion-Version': NOTION_VERSION,
                    'Content-Type': 'application/json'
                },
                data
            });
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Notion HTTP ${response.status}`);
            }

            pages.push(...response.data.results);
            cursor = response.data.has_more ? response.data.next_cursor : null;
        } while (cursor);

        return pages;
    }

    function updateStatus() {
        const status = document.getElementById('notion-shared-context-status');
        if (!status) return;
        status.textContent = settings().lastSyncedAt
            ? `上次同步：${new Date(settings().lastSyncedAt).toLocaleString()}`
            : '尚未同步';
    }

    async function runSync() {
        const config = settings();
        if (!config.enabled || !config.dataSourceId || !config.token) {
            return { skipped: true };
        }

        try {
            const pages = await queryPages(config);
            const records = pages.map(mapPage);
            await window.UwUSharedContext.importRecords(records);

            if (records.length) {
                config.lastSyncTime = records.reduce(
                    (latest, record) => record.time > latest ? record.time : latest,
                    config.lastSyncTime || ''
                );
            }
            config.lastSyncedAt = new Date().toISOString();
            await saveGlobalSettings();
            updateStatus();
            return { synced: records.length, records };
        } catch (error) {
            console.warn('[Notion Shared Context] 同步失败：', error);
            return { error };
        }
    }

    function sync() {
        if (!syncInFlight) {
            syncInFlight = runSync().finally(() => {
                syncInFlight = null;
            });
        }
        return syncInFlight;
    }

    function setupSettings() {
        const enabled = document.getElementById('notion-shared-context-enabled');
        const dataSourceId = document.getElementById('notion-shared-context-data-source-id');
        const token = document.getElementById('notion-shared-context-token');
        const saveButton = document.getElementById('notion-shared-context-save');
        const config = settings();

        enabled.checked = config.enabled;
        dataSourceId.value = config.dataSourceId;
        token.value = config.token;
        updateStatus();

        saveButton.addEventListener('click', async () => {
            const sourceChanged = config.dataSourceId !== dataSourceId.value.trim();
            config.enabled = enabled.checked;
            config.dataSourceId = dataSourceId.value.trim();
            config.token = token.value.trim();
            if (sourceChanged) config.lastSyncTime = '';
            await saveGlobalSettings();
            const result = await sync();
            showToast(result.error ? 'Notion 同步失败' : 'Notion Shared Context 已保存');
        });
    }

    function init() {
        if (initialized) return;
        initialized = true;
        setupSettings();
        setTimeout(sync, 4000);
    }

    window.UwUNotionSharedContextSync = { init, sync, mapPage };
})();
