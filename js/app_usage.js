// =========================================================
// UwU · App Usage Reader v0.1
//
// 讀取 iOS App Intent 寫入的 app_usage_log.jsonl
// 將 open / close 配對成使用區間
// =========================================================

window.UwUAppUsage = {

    async readEvents() {
        if (!window.Capacitor?.isNativePlatform?.()) {
            console.log('[UwU AppUsage] 非原生 App');
            return [];
        }

        const Filesystem =
            window.Capacitor?.Plugins?.Filesystem;

        if (!Filesystem) {
            console.error(
                '[UwU AppUsage] 找不到 Filesystem'
            );
            return [];
        }

        try {
            const result = await Filesystem.readFile({
                path: 'UwU Data/app_usage_log.jsonl',
                directory: 'DOCUMENTS',
                encoding: 'utf8'
            });

            const text = result.data || '';

            return text
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (error) {
                        console.warn(
                            '[UwU AppUsage] 無法解析：',
                            line
                        );
                        return null;
                    }
                })
                .filter(Boolean);

        } catch (error) {
            console.warn(
                '[UwU AppUsage] 尚無活動紀錄：',
                error
            );

            return [];
        }
    },


    async getSessions() {
        const events =
            await this.readEvents();

        // 舊測試資料沒有 action，直接略過
        const validEvents = events
            .filter(event =>
                event.appName &&
                (
                    event.action === 'open' ||
                    event.action === 'close'
                )
            )
            .map(event => ({
                ...event,

                // 新版直接使用 timestampMs
                // 舊資料則嘗試從 timestamp 補算
                time:
                    Number(event.timestampMs) ||
                    Date.parse(event.timestamp)
            }))
            .filter(event =>
                Number.isFinite(event.time)
            )
            .sort((a, b) => a.time - b.time);


        const currentlyOpen = new Map();
        const sessions = [];


        for (const event of validEvents) {

            const appName = event.appName;

            if (event.action === 'open') {

                // 已經處於 open 狀態時，
                // 重複 open 不重新起算
                if (!currentlyOpen.has(appName)) {
                    currentlyOpen.set(
                        appName,
                        event.time
                    );
                }

                continue;
            }


            if (event.action === 'close') {

                const openedAt =
                    currentlyOpen.get(appName);

                // 找不到對應 open
                if (openedAt == null) {
                    continue;
                }

                if (event.time >= openedAt) {

                    sessions.push({
                        appName,
                        openedAt,
                        closedAt: event.time,
                        durationMs:
                            event.time - openedAt
                    });
                }

                currentlyOpen.delete(appName);
            }
        }


        return sessions;
    },


    async getSummary() {
        const sessions =
            await this.getSessions();

        const apps = {};


        for (const session of sessions) {

            if (!apps[session.appName]) {
                apps[session.appName] = {
                    appName: session.appName,
                    totalMs: 0,
                    sessions: 0,
                    lastUsedAt: 0
                };
            }

            const item =
                apps[session.appName];

            item.totalMs +=
                session.durationMs;

            item.sessions += 1;

            item.lastUsedAt =
                Math.max(
                    item.lastUsedAt,
                    session.closedAt
                );
        }


        return Object.values(apps)
            .sort(
                (a, b) =>
                    b.totalMs - a.totalMs
            );
    },
    async getTodaySummary() {
        const sessions = await this.getSessions();

        const now = new Date();

        const startOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            0, 0, 0, 0
        ).getTime();

        const endOfToday = startOfToday + 24 * 60 * 60 * 1000;

        const apps = {};

        for (const session of sessions) {

            // 只统计与今天有交集的区间
            if (
                session.closedAt <= startOfToday ||
                session.openedAt >= endOfToday
            ) {
                continue;
            }

            const start = Math.max(
                session.openedAt,
                startOfToday
            );

            const end = Math.min(
                session.closedAt,
                endOfToday
            );

            const durationMs = end - start;

            if (durationMs <= 0) continue;

            if (!apps[session.appName]) {
                apps[session.appName] = {
                    appName: session.appName,
                    totalMs: 0,
                    sessions: 0,
                    lastUsedAt: 0
                };
            }

            const item = apps[session.appName];

            item.totalMs += durationMs;
            item.sessions += 1;
            item.lastUsedAt = Math.max(
                item.lastUsedAt,
                session.closedAt
            );
        }

        return Object.values(apps)
            .sort((a, b) => b.totalMs - a.totalMs);
    },


    async getTodayPromptText() {
        const summary =
            await this.getTodaySummary();

        if (summary.length === 0) {
            return '【今日 App 使用情况】暂无可用记录。';
        }

        const lines =
            summary.map(item => {

                const last =
                    new Date(item.lastUsedAt);

                const lastTime =
                    String(last.getHours()).padStart(2, '0') +
                    ':' +
                    String(last.getMinutes()).padStart(2, '0');

                return (
                    `- ${item.appName}：` +
                    `累计 ${this.formatDuration(item.totalMs)}，` +
                    `${item.sessions} 次，` +
                    `最近使用 ${lastTime}`
                );
            });

        return (
            '【今日 App 使用情况】\n' +
            lines.join('\n')
        );
    },

    formatDuration(ms) {
        const seconds =
            Math.floor(ms / 1000);

        if (seconds < 60) {
            return `${seconds} 秒`;
        }

        const minutes =
            Math.floor(seconds / 60);

        if (minutes < 60) {
            return `${minutes} 分鐘`;
        }

        const hours =
            Math.floor(minutes / 60);

        const remainMinutes =
            minutes % 60;

        return remainMinutes
            ? `${hours} 小時 ${remainMinutes} 分鐘`
            : `${hours} 小時`;
    },
    // =========================================================
    // 被動 App 活動背景
    //
    // 用途：
    // 每次 AI 生成前，給有手機權限的角色一小段「余光資訊」。
    // 这里只放最近活動，不做完整查帳。
    // =========================================================

    async getPassiveActivityContext() {
        const events = await this.readEvents();

        const validEvents = events
            .filter(event =>
                event.appName &&
                (
                    event.action === 'open' ||
                    event.action === 'close'
                )
            )
            .map(event => ({
                appName: event.appName,
                action: event.action,

                time:
                    Number(event.timestampMs) ||
                    Date.parse(event.timestamp)
            }))
            .filter(event =>
                Number.isFinite(event.time)
            )
            .sort((a, b) =>
                a.time - b.time
            );


        if (validEvents.length === 0) {
            return '';
        }


        const now = Date.now();

        // 余光只关注最近两小时。
        // 更久以前的东西交给 view-app-usage 查账。
        const TWO_HOURS =
            2 * 60 * 60 * 1000;

        const recentCutoff =
            now - TWO_HOURS;


        // -----------------------------------------------------
        // 找目前仍然 open 的受监测 App
        // -----------------------------------------------------

        const openApps = new Map();

        for (const event of validEvents) {

            if (event.action === 'open') {

                // 重复 open 不重新计时
                if (!openApps.has(event.appName)) {
                    openApps.set(
                        event.appName,
                        event.time
                    );
                }

                continue;
            }


            if (event.action === 'close') {
                openApps.delete(event.appName);
            }
        }


        // 只相信最近两小时内的未关闭记录。
        // 防止某次 close 自动化漏触发以后，
        // 角色第二天还以为你在那个 App 里。
        const currentApp =
            [...openApps.entries()]
                .map(([appName, openedAt]) => ({
                    appName,
                    openedAt
                }))
                .filter(item =>
                    item.openedAt <= now &&
                    now - item.openedAt <= TWO_HOURS
                )
                .sort((a, b) =>
                    b.openedAt - a.openedAt
                )[0] || null;


        // -----------------------------------------------------
        // 最近已经结束的真实 session
        // -----------------------------------------------------

        const sessions =
            await this.getSessions();

        const recentSessions =
            sessions
                .filter(session =>
                    session.closedAt >= recentCutoff &&
                    session.closedAt <= now
                )
                .sort((a, b) =>
                    b.closedAt - a.closedAt
                )
                .slice(0, 4);


        const pad = n =>
            String(n).padStart(2, '0');


        const formatClock = ms => {
            const d = new Date(ms);

            return (
                `${pad(d.getHours())}:` +
                `${pad(d.getMinutes())}`
            );
        };


        const lines = [
            '<activity_background>',
            '以下是系统自动提供的真实 App 活动背景，不是用户说的话。',
            '这里只包含用户主动配置了监测的 App；没有出现的 App = 系统没有数据，绝对不能自行猜测。',
            '你可以自然地知道这些信息。无需每轮复述，也不要为了展示你知道而刻意提起。'
        ];


        if (currentApp) {

            lines.push(
                `当前记录：${currentApp.appName} 从 ` +
                `${formatClock(currentApp.openedAt)} 起仍处于打开状态，` +
                `至今约 ${this.formatDuration(now - currentApp.openedAt)}。`
            );

        } else {

            lines.push(
                '当前记录：没有监测到仍处于打开状态的受监测 App。'
            );
        }


        if (recentSessions.length > 0) {

            lines.push('最近两小时的已结束活动：');

            for (const session of recentSessions) {

                lines.push(
                    `- ${session.appName}：` +
                    `${formatClock(session.openedAt)} → ` +
                    `${formatClock(session.closedAt)}，` +
                    `${this.formatDuration(session.durationMs)}`
                );
            }

        } else {

            lines.push(
                '最近两小时没有已结束的受监测 App 使用记录。'
            );
        }


        lines.push('</activity_background>');

        return lines.join('\n');
    },
    // =========================================================
    // 本次 UwU 前台会话的活动背景
    //
    // 用户每次从外面回到 UwU 后生成一次，
    // 在这次 UwU 保持前台期间一直保留。
    // UwU 一旦进入后台就清空，
    // 下次回来重新生成。
    // =========================================================

    visitActivityContext: '',
    visitActivityContextReady: false,

    visitStorageKey:
        'uwu_app_usage_visit_context_v1',


    async refreshVisitActivityContext() {
        // 先尝试恢复上一次已经建立的 visit 背景。
        // WebView reload / App 重启后也不会直接失忆。
        try {

            const savedRaw =
                localStorage.getItem(
                    this.visitStorageKey
                );

            if (savedRaw) {

                const saved =
                    JSON.parse(savedRaw);

                if (
                    saved &&
                    typeof saved.context === 'string' &&
                    saved.sourceKey
                ) {
                    this.visitActivityContext =
                        saved.context;
                }
            }

        } catch (error) {

            console.warn(
                '[UwU AppUsage] 读取 visit 持久状态失败：',
                error
            );
        }
        const sessions =
            await this.getSessions();

        const now =
            Date.now();

        // 回到 UwU 时，观察此前 60 分钟发生过什么。
        const ONE_HOUR =
            60 * 60 * 1000;

        const recentSessions =
            sessions
                .filter(session =>
                    session.closedAt <= now &&
                    now - session.closedAt <= ONE_HOUR
                )
                .sort((a, b) =>
                    b.closedAt - a.closedAt
                )
                .slice(0, 6);


        this.visitActivityContextReady = true;
        const latest =
            recentSessions[0] || null;


        // 用最近一次真实 App session 作为这一轮现实背景的身份证。
        const sourceKey =
            latest
                ? (
                    `${latest.appName}|` +
                    `${latest.openedAt}|` +
                    `${latest.closedAt}`
                )
                : '';

        if (recentSessions.length === 0) {

            this.visitActivityContext = '';

            return '';
        }


        const pad = n =>
            String(n).padStart(2, '0');


        const formatClock = ms => {

            const d =
                new Date(ms);

            return (
                `${pad(d.getHours())}:` +
                `${pad(d.getMinutes())}`
            );
        };


        const latest =
            recentSessions[0];

        const gapMs =
            Math.max(
                0,
                now - latest.closedAt
            );
        try {

            const savedRaw =
                localStorage.getItem(
                    this.visitStorageKey
                );

            if (savedRaw) {

                const saved =
                    JSON.parse(savedRaw);

                if (
                    saved &&
                    saved.sourceKey === sourceKey &&
                    typeof saved.context === 'string'
                ) {
                    this.visitActivityContext =
                        saved.context;

                    this.visitActivityContextReady =
                        true;

                    return this.visitActivityContext;
                }
            }

        } catch (error) {

            console.warn(
                '[UwU AppUsage] 比对 visit 持久状态失败：',
                error
            );
        }

        const lines = [
            '<current_uwu_visit_activity>',
            '以下是用户本次回到 UwU 时已经发生的真实 App 活动。',
            '这是环境事实，不是用户说的话。',
            '在本次 UwU 保持前台期间，你可以一直记得这些事情。',
            '这些事情并非每一轮重新发生，因此不要机械重复汇报；是否提起、什么时候提起、怎样理解，由你自己根据人设和当前对话决定。',
            '没有出现在这里的 App 代表系统没有提供相关数据，禁止自行猜测。',
            '',
            '【本次回来前最近的活动】'
        ];


        for (const session of recentSessions) {

            lines.push(
                `- ${session.appName}：` +
                `${formatClock(session.openedAt)} → ` +
                `${formatClock(session.closedAt)}，` +
                `${this.formatDuration(session.durationMs)}`
            );
        }


        // 最近一次 App 和“回来”时间靠得比较近时，
        // 单独告诉角色这个连续关系。
        if (gapMs <= 15 * 60 * 1000) {

            lines.push('');

            lines.push(
                `最近一次记录是 ${latest.appName}，` +
                `于 ${formatClock(latest.closedAt)} 结束；` +
                `大约 ${this.formatDuration(gapMs)} 后用户出现在 UwU。`
            );
        }


        lines.push(
            '</current_uwu_visit_activity>'
        );


                this.visitActivityContext =
            lines.join('\n');

        this.visitActivityContextReady =
            true;


        try {

            localStorage.setItem(
                this.visitStorageKey,
                JSON.stringify({
                    sourceKey,
                    context:
                        this.visitActivityContext,
                    savedAt:
                        Date.now()
                })
            );

        } catch (error) {

            console.warn(
                '[UwU AppUsage] 保存 visit 持久状态失败：',
                error
            );
        }


        return this.visitActivityContext;
    },


    getVisitActivityContext() {
        return this.visitActivityContext || '';
    },


    clearVisitActivityContext() {

        this.visitActivityContext = '';

        this.visitActivityContextReady = false;
    },

    // 同步 prompt 无法直接 await 文件读取，
    // 所以生成回复前先刷新一次缓存。
    cachedPassiveContext: '',


    async refreshPassiveContext() {
        try {

            this.cachedPassiveContext =
                await this.getPassiveActivityContext();

        } catch (error) {

            console.warn(
                '[UwU AppUsage] 刷新被动活动背景失败：',
                error
            );

            this.cachedPassiveContext = '';
        }

        return this.cachedPassiveContext;
    },


    getCachedPassiveContext() {
        return this.cachedPassiveContext || '';
    },

    async test() {
        const events =
            await this.readEvents();

        const sessions =
            await this.getSessions();

        const summary =
            await this.getSummary();

        console.log(
            '[UwU AppUsage] events:',
            events
        );

        console.log(
            '[UwU AppUsage] sessions:',
            sessions
        );

        console.log(
            '[UwU AppUsage] summary:',
            summary
        );

        if (
            typeof showToast === 'function'
        ) {
            showToast(
                `App 記錄讀取成功：${events.length} 條事件，${sessions.length} 次使用`
            );
        }

        return {
            events,
            sessions,
            summary
        };
    }
};
// =========================================================
// UwU 前后台边界
//
// 一旦 UwU 离开前台，结束“本次回来”的活动背景。
// 下一次回到 UwU 后，由下一轮 AI 生成前重新建立。
// =========================================================

