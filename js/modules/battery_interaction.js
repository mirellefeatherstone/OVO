// =============================================================
// UwU Battery Awareness v1
// 原生 iOS 电量状态 → ambient context + Event Bus producer
// =============================================================

const BatteryInteraction = {
    storageKey: 'uwu_battery_awareness_state_v1',
    initialized: false,
    initPromise: null,
    currentStatus: null,

    loadState() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            const parsed = raw ? JSON.parse(raw) : {};

            return {
                lastStatus: parsed.lastStatus || null,
                lowArmed: parsed.lowArmed !== false,
                criticalArmed: parsed.criticalArmed !== false,
                completedArmed: parsed.completedArmed !== false,
                events: Array.isArray(parsed.events)
                    ? parsed.events
                    : []
            };
        } catch (error) {
            console.warn(
                '[UwU Battery] 读取持久状态失败：',
                error
            );
            return {
                lastStatus: null,
                lowArmed: true,
                criticalArmed: true,
                completedArmed: true,
                events: []
            };
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
                '[UwU Battery] 保存持久状态失败：',
                error
            );
        }
    },

    normalizeStatus(raw) {
        const level = Number(raw?.level);

        if (!Number.isFinite(level) || level < 0) {
            return null;
        }

        const state = String(raw?.state || 'unknown');
        const charging = raw?.charging === true || state === 'full';

        return {
            level: Math.max(0, Math.min(100, Math.round(level))),
            charging,
            state,
            observedAt:
                Number(raw?.timestampMs) || Date.now()
        };
    },

    makeEvent(type, status, options) {
        const happenedAt = status.observedAt || Date.now();

        return {
            source: 'battery',
            type,
            happenedAt,
            expiresAt: happenedAt + options.ttlMs,
            significance: options.significance,
            sourceKey: `${type}|${happenedAt}`,
            summary: options.summary,
            payload: {
                level: status.level,
                charging: status.charging,
                state: status.state
            }
        };
    },

    processStatus(rawStatus) {
        const status = this.normalizeStatus(rawStatus);

        if (!status) return;

        const state = this.loadState();
        const previous = state.lastStatus;
        const generated = [];
        const ONE_HOUR = 60 * 60 * 1000;

        // Hysteresis：必须恢复到更高阈值才重新武装。
        if (status.level >= 25) state.lowArmed = true;
        if (status.level >= 15) state.criticalArmed = true;

        if (!status.charging) {
            state.completedArmed = true;
        }

        if (previous) {
            const crossedCritical =
                previous.level > 10 &&
                status.level <= 10 &&
                !status.charging &&
                state.criticalArmed;

            if (crossedCritical) {
                generated.push(this.makeEvent(
                    'battery_critical',
                    status,
                    {
                        ttlMs: 4 * ONE_HOUR,
                        significance: 0.94,
                        summary:
                            `设备电量刚降到 ${status.level}%，已进入极低电量且未充电。`
                    }
                ));
                state.criticalArmed = false;
                state.lowArmed = false;
            } else {
                const crossedLow =
                    previous.level > 20 &&
                    status.level <= 20 &&
                    !status.charging &&
                    state.lowArmed;

                if (crossedLow) {
                    generated.push(this.makeEvent(
                        'battery_low',
                        status,
                        {
                            ttlMs: 6 * ONE_HOUR,
                            significance: 0.74,
                            summary:
                                `设备电量刚降到 ${status.level}%，当前未充电。`
                        }
                    ));
                    state.lowArmed = false;
                }
            }

            const chargingStarted =
                !previous.charging &&
                status.charging;

            if (chargingStarted && status.level < 95) {
                generated.push(this.makeEvent(
                    'charging_started',
                    status,
                    {
                        ttlMs: 2 * ONE_HOUR,
                        significance: 0.56,
                        summary:
                            `设备刚开始充电，当前电量 ${status.level}%。`
                    }
                ));
            }

            const chargingCompleted =
                status.charging &&
                status.level >= 95 &&
                state.completedArmed &&
                (
                    !previous.charging ||
                    previous.level < 95
                );

            if (chargingCompleted) {
                generated.push(this.makeEvent(
                    'charging_completed',
                    status,
                    {
                        ttlMs: 4 * ONE_HOUR,
                        significance: 0.66,
                        summary:
                            `设备充电已接近完成，当前电量 ${status.level}%。`
                    }
                ));
                state.completedArmed = false;
            }
        }

        const now = Date.now();
        state.events = [...state.events, ...generated]
            .filter(event => event.expiresAt > now)
            .sort((a, b) =>
                b.significance - a.significance ||
                b.happenedAt - a.happenedAt
            );
        state.lastStatus = status;
        this.currentStatus = status;
        this.saveState(state);
        this.updateBatteryDisplays();

        window.dispatchEvent(new CustomEvent(
            'uwu:battery-status',
            {detail: status}
        ));
    },

    async init() {
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            const plugin =
                window.Capacitor?.Plugins?.UwUBattery;

            if (!plugin?.getStatus) {
                console.warn(
                    '[UwU Battery] 找不到原生 UwUBattery plugin'
                );
                return null;
            }

            const initialStatus = await plugin.getStatus();
            this.processStatus(initialStatus);

            if (typeof plugin.addListener === 'function') {
                await plugin.addListener(
                    'batteryStatusChanged',
                    status => this.processStatus(status)
                );
            }

            this.initialized = true;
            console.log('[UwU Battery] 原生电量监听已启用');

            return this.currentStatus;
        })().catch(error => {
            this.initPromise = null;
            console.warn(
                '[UwU Battery] 初始化失败：',
                error
            );
            return null;
        });

        return this.initPromise;
    },

    async getStatus() {
        await this.init();
        return this.currentStatus;
    },

    getCurrentStatus() {
        return this.currentStatus;
    },

    getEvents() {
        const state = this.loadState();
        const now = Date.now();

        state.events = state.events
            .filter(event => event.expiresAt > now);
        this.saveState(state);

        return state.events;
    },

    getAmbientContext() {
        const status = this.currentStatus;

        if (!status) return '';

        const chargingText = status.charging
            ? '当前正在充电'
            : '当前未充电';

        return [
            '<device_battery>',
            '以下是系统提供的真实设备电量状态，不是用户说的话。',
            `当前电量：${status.level}%`,
            chargingText,
            '知道即可；不要每轮报告电量，也不要为了展示感知能力而刻意提起。',
            '</device_battery>'
        ].join('\n');
    },

    updateBatteryDisplays() {
        const status = this.currentStatus;

        if (!status) return;

        const ratio = status.level / 100;
        const fillColor = status.charging
            ? '#4CAF50'
            : (status.level <= 20 ? '#f44336' : '#666');

        document.querySelectorAll(
            '#battery-level, #statusbar-preview-level, .htsb-battery-level'
        ).forEach(element => {
            element.textContent = `${status.level}%`;
        });

        document.querySelectorAll(
            '#battery-fill-rect, #statusbar-preview-battery-fill, .htsb-battery-fill'
        ).forEach(element => {
            element.setAttribute('width', 18 * ratio);
            element.setAttribute('fill', fillColor);
        });

        const widget = document.querySelector('.widget-battery');
        if (widget) widget.style.display = '';
    },

    // 兼容旧调用点：电量不再自行请求模型或弹独立气泡。
    async triggerIndependentCheck() {
        return false;
    }
};

window.BatteryInteraction = BatteryInteraction;

window.UwUEventBus?.registerProducer(
    'battery',
    () => BatteryInteraction.getEvents()
);
