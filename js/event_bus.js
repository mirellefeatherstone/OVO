// =============================================================
// UwU Reality Event Bus v1
// =============================================================

(() => {
    const producers = new Map();

    const bus = {
        storageKey: 'uwu_reality_event_bus_state_v1',
        legacyStorageKey: 'uwu_app_usage_proactive_state_v1',

        registerProducer(source, producer) {
            if (
                !source ||
                (typeof producer !== 'function' &&
                    typeof producer?.getEvents !== 'function')
            ) {
                throw new Error('UwUEventBus producer 格式无效');
            }

            producers.set(source, producer);
        },

        normalizeEvent(source, event) {
            const now = Date.now();
            const happenedAt = Number(event?.happenedAt);
            const expiresAt = Number(event?.expiresAt);
            const significance = Number(event?.significance);

            if (
                !event?.type ||
                !event?.sourceKey ||
                !event?.summary ||
                !Number.isFinite(happenedAt) ||
                !Number.isFinite(expiresAt) ||
                expiresAt <= now
            ) {
                return null;
            }

            return {
                source: event.source || source,
                type: event.type,
                happenedAt,
                expiresAt,
                significance: Number.isFinite(significance)
                    ? Math.max(0, Math.min(1, significance))
                    : 0.5,
                sourceKey: String(event.sourceKey),
                summary: String(event.summary),
                payload:
                    event.payload && typeof event.payload === 'object'
                        ? event.payload
                        : {}
            };
        },

        async collectEvents() {
            const collected = [];

            for (const [source, producer] of producers) {
                try {
                    const result = typeof producer === 'function'
                        ? await producer()
                        : await producer.getEvents();

                    for (const rawEvent of result || []) {
                        const event = this.normalizeEvent(
                            source,
                            rawEvent
                        );

                        if (event) collected.push(event);
                    }
                } catch (error) {
                    console.warn(
                        `[UwU EventBus] producer ${source} 收集失败：`,
                        error
                    );
                }
            }

            const deduped = new Map();

            for (const event of collected) {
                const key = `${event.source}|${event.sourceKey}`;
                const existing = deduped.get(key);

                if (
                    !existing ||
                    event.significance > existing.significance ||
                    event.happenedAt > existing.happenedAt
                ) {
                    deduped.set(key, event);
                }
            }

            return [...deduped.values()]
                .sort((a, b) =>
                    b.significance - a.significance ||
                    b.happenedAt - a.happenedAt
                );
        },

        loadState() {
            try {
                const currentRaw = localStorage.getItem(
                    this.storageKey
                );

                if (currentRaw) {
                    const current = JSON.parse(currentRaw);

                    return current && typeof current === 'object'
                        ? current
                        : {};
                }

                // 无缝继承 Activity v3 已有的 handled/cooldown 状态。
                const legacyRaw = localStorage.getItem(
                    this.legacyStorageKey
                );
                const legacy = legacyRaw
                    ? JSON.parse(legacyRaw)
                    : {};

                return legacy && typeof legacy === 'object'
                    ? legacy
                    : {};

            } catch (error) {
                console.warn(
                    '[UwU EventBus] 读取状态失败：',
                    error
                );
                return {};
            }
        },

        saveState(state) {
            try {
                localStorage.setItem(
                    this.storageKey,
                    JSON.stringify(state)
                );
            } catch (error) {
                console.warn(
                    '[UwU EventBus] 保存状态失败：',
                    error
                );
            }
        },

        stateKey(characterId, event) {
            return (
                `${characterId}|${event.source}|` +
                `${event.sourceKey}`
            );
        },

        legacyStateKey(characterId, event) {
            return `${characterId}|${event.sourceKey}`;
        },

        pruneState(state, now) {
            for (const [key, item] of Object.entries(state)) {
                if (!item || !item.expiresAt || item.expiresAt <= now) {
                    delete state[key];
                }
            }
        },

        async getPendingEvents(characterId) {
            if (!characterId) return [];

            const now = Date.now();
            const events = await this.collectEvents();
            const state = this.loadState();

            this.pruneState(state, now);

            const cooldown =
                state[`${characterId}|__decision_cooldown__`];

            this.saveState(state);

            if (
                cooldown?.deliveryVersion === 2 &&
                cooldown?.nextAttemptAt &&
                cooldown.nextAttemptAt > now
            ) {
                return [];
            }

            const pending = events.filter(event => {
                const item =
                    state[this.stateKey(characterId, event)] ||
                    (
                        event.source === 'app_activity'
                            ? state[
                                this.legacyStateKey(
                                    characterId,
                                    event
                                )
                            ]
                            : null
                    );

                if (!item) return true;
                if (item.status === 'handled') {
                    return (
                        item.decision === 'respond' &&
                        item.deliveryVersion !== 2
                    );
                }

                return (
                    !item.nextAttemptAt ||
                    item.nextAttemptAt <= now
                );
            });

            // Event Bus 每次只交出全局最高优先级的一条。
            return pending.slice(0, 1);
        },

        markHandled(event, characterId, decision) {
            if (!event?.sourceKey || !characterId) return;

            const now = Date.now();
            const state = this.loadState();
            const cooldownMs = decision === 'respond'
                ? 2 * 60 * 60 * 1000
                : 30 * 60 * 1000;

            state[this.stateKey(characterId, event)] = {
                status: 'handled',
                decision: decision === 'respond'
                    ? 'respond'
                    : 'ignore',
                deliveryVersion: 2,
                handledAt: now,
                expiresAt: event.expiresAt
            };
            state[`${characterId}|__decision_cooldown__`] = {
                status: 'cooldown',
                deliveryVersion: 2,
                nextAttemptAt: now + cooldownMs,
                expiresAt: now + cooldownMs
            };

            this.saveState(state);
        },

        defer(event, characterId, retryMs = 15 * 60 * 1000) {
            if (!event?.sourceKey || !characterId) return;

            const state = this.loadState();
            state[this.stateKey(characterId, event)] = {
                status: 'deferred',
                nextAttemptAt: Date.now() + retryMs,
                expiresAt: event.expiresAt
            };
            this.saveState(state);
        }
    };

    window.UwUEventBus = bus;
})();
