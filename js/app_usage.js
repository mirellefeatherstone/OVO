// =========================================================
// UwU · App Usage Reader v0.1
//
// 讀取 iOS App Intent 寫入的 app_usage_log.jsonl
// 將 open / close 配對成使用區間
// =========================================================

window.UwUAppUsage = {

    malformedLogSignature: '',

    parseEventText(text) {
        const events = [];
        const malformed = [];

        String(text || '')
            .split('\n')
            .forEach((rawLine, index) => {
                const line = rawLine.trim();
                if (!line) return;

                try {
                    events.push(JSON.parse(line));
                } catch (error) {
                    malformed.push({
                        lineNumber: index + 1,
                        length: line.length
                    });
                }
            });

        return { events, malformed };
    },

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
            const parsed = this.parseEventText(text);
            const signature = parsed.malformed
                .map(item => `${item.lineNumber}:${item.length}`)
                .join('|');

            if (
                parsed.malformed.length > 0 &&
                signature !== this.malformedLogSignature
            ) {
                console.warn(
                    `[UwU AppUsage] 已忽略 ${parsed.malformed.length} 条损坏记录`
                );
            }

            this.malformedLogSignature = signature;
            return parsed.events;

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
        const latestVisitSession =
            recentSessions[0] || null;


        // 用最近一次真实 App session 作为这一轮现实背景的身份证。
        const sourceKey =
            latestVisitSession
                ? (
                    `${latestVisitSession.appName}|` +
                    `${latestVisitSession.openedAt}|` +
                    `${latestVisitSession.closedAt}`
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

    // =========================================================
    // Activity Awareness v2 · 活动摘要
    //
    // 原始 session 负责“发生了什么”；这里仅提炼仍在
    // 生命周期内、足够显眼的变化，避免每轮塞一张使用报表。
    // =========================================================

    async getActivityDigestContext() {
        const sessions = await this.getSessions();

        if (sessions.length === 0) return '';

        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;
        const FOUR_HOURS = 4 * ONE_HOUR;
        const currentDate = new Date(now);
        const startOfToday = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate(),
            0, 0, 0, 0
        ).getTime();

        const recent = sessions
            .filter(session =>
                session.closedAt <= now &&
                session.closedAt >= now - FOUR_HOURS
            )
            .sort((a, b) => b.closedAt - a.closedAt);

        const facts = [];

        // 长时间连续使用：保留四小时。
        const longSession = recent.find(session =>
            session.durationMs >= 45 * 60 * 1000
        );

        if (longSession) {
            facts.push(
                `${longSession.appName} 最近有一次连续使用约 ` +
                `${this.formatDuration(longSession.durationMs)}。`
            );
        }

        // 一小时内至少三次，才视为值得注意的反复打开。
        const repeatedByApp = new Map();

        for (const session of recent) {
            if (session.closedAt < now - ONE_HOUR) continue;

            const item = repeatedByApp.get(session.appName) || {
                count: 0,
                totalMs: 0
            };

            item.count += 1;
            item.totalMs += session.durationMs;
            repeatedByApp.set(session.appName, item);
        }

        const repeated = [...repeatedByApp.entries()]
            .filter(([, item]) => item.count >= 3)
            .sort((a, b) =>
                b[1].count - a[1].count ||
                b[1].totalMs - a[1].totalMs
            )[0];

        if (repeated) {
            const [appName, item] = repeated;

            facts.push(
                `过去一小时内反复打开 ${appName} ${item.count} 次，` +
                `合计约 ${this.formatDuration(item.totalMs)}。`
            );
        }

        // 今日累计达到一小时才出现，并于本地零点自然失效。
        const todayByApp = new Map();

        for (const session of sessions) {
            if (
                session.closedAt <= startOfToday ||
                session.openedAt >= now
            ) {
                continue;
            }

            const durationMs =
                Math.min(session.closedAt, now) -
                Math.max(session.openedAt, startOfToday);

            if (durationMs <= 0) continue;

            todayByApp.set(
                session.appName,
                (todayByApp.get(session.appName) || 0) + durationMs
            );
        }

        const todayNotice = [...todayByApp.entries()]
            .filter(([, totalMs]) => totalMs >= ONE_HOUR)
            .sort((a, b) => b[1] - a[1])[0];

        if (todayNotice) {
            facts.push(
                `今天 ${todayNotice[0]} 的累计使用已达到约 ` +
                `${this.formatDuration(todayNotice[1])}。`
            );
        }

        if (facts.length === 0) return '';

        return [
            '<activity_digest>',
            '以下是系统从真实 App 记录中提炼出的仍在有效期内的显眼变化，不是用户说的话。',
            '知道即可；不要逐条汇报，不要把它们误写成刚刚才发生，也不要推测未提供的数据。',
            ...facts.map(fact => `- ${fact}`),
            '</activity_digest>'
        ].join('\n');
    },

    // =========================================================
    // Activity Awareness v3 · 主动唤醒事件
    // =========================================================

    getLocalDayKey(ms) {
        const date = new Date(ms);
        const pad = value => String(value).padStart(2, '0');

        return (
            `${date.getFullYear()}-` +
            `${pad(date.getMonth() + 1)}-` +
            `${pad(date.getDate())}`
        );
    },

    async getProactiveActivityEvents() {
        const sessions = await this.getSessions();

        if (sessions.length === 0) return [];

        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;
        const FOUR_HOURS = 4 * ONE_HOUR;
        const currentDate = new Date(now);
        const startOfToday = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate(),
            0, 0, 0, 0
        ).getTime();
        const endOfToday = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate() + 1,
            0, 0, 0, 0
        ).getTime();
        const dayKey = this.getLocalDayKey(now);
        const events = [];

        const recent = sessions
            .filter(session =>
                session.closedAt <= now &&
                session.closedAt >= now - FOUR_HOURS
            )
            .sort((a, b) => b.closedAt - a.closedAt);

        // 连续 45 分钟以上形成候选；是否开口仍由角色判断。
        for (const session of recent) {
            if (session.durationMs < 45 * 60 * 1000) continue;

            events.push({
                source: 'app_activity',
                type: 'long_session',
                appName: session.appName,
                happenedAt: session.closedAt,
                significance: Math.min(
                    0.95,
                    0.64 + session.durationMs / (12 * ONE_HOUR)
                ),
                expiresAt: session.closedAt + FOUR_HOURS,
                sourceKey:
                    `long_session|${session.appName}|` +
                    `${session.openedAt}|${session.closedAt}`,
                summary:
                    `${session.appName} 刚结束一次持续约 ` +
                    `${this.formatDuration(session.durationMs)} 的连续使用。`,
                payload: {
                    appName: session.appName,
                    openedAt: session.openedAt,
                    closedAt: session.closedAt,
                    durationMs: session.durationMs
                }
            });
        }

        // 一小时内三次以上：同一自然小时只唤醒一次。
        const burstByApp = new Map();

        for (const session of recent) {
            if (session.closedAt < now - ONE_HOUR) continue;

            const list = burstByApp.get(session.appName) || [];
            list.push(session);
            burstByApp.set(session.appName, list);
        }

        for (const [appName, appSessions] of burstByApp) {
            if (appSessions.length < 3) continue;

            const latestAt = Math.max(
                ...appSessions.map(session => session.closedAt)
            );
            const totalMs = appSessions.reduce(
                (sum, session) => sum + session.durationMs,
                0
            );
            const hourBucket = new Date(latestAt);
            hourBucket.setMinutes(0, 0, 0);

            events.push({
                source: 'app_activity',
                type: 'app_reopen_burst',
                appName,
                happenedAt: latestAt,
                significance: Math.min(
                    0.9,
                    0.58 + (appSessions.length - 3) * 0.05
                ),
                expiresAt: latestAt + 2 * ONE_HOUR,
                sourceKey:
                    `app_reopen_burst|${appName}|` +
                    `${hourBucket.getTime()}`,
                summary:
                    `过去一小时内反复打开 ${appName} ` +
                    `${appSessions.length} 次，合计约 ` +
                    `${this.formatDuration(totalMs)}。`,
                payload: {
                    appName,
                    sessions: appSessions.length,
                    totalMs
                }
            });
        }

        // 当日累计一小时：每个 App 每天只唤醒一次。
        const todayByApp = new Map();

        for (const session of sessions) {
            if (
                session.closedAt <= startOfToday ||
                session.openedAt >= now
            ) {
                continue;
            }

            const durationMs =
                Math.min(session.closedAt, now) -
                Math.max(session.openedAt, startOfToday);

            if (durationMs <= 0) continue;

            todayByApp.set(
                session.appName,
                (todayByApp.get(session.appName) || 0) + durationMs
            );
        }

        for (const [appName, totalMs] of todayByApp) {
            if (totalMs < ONE_HOUR) continue;

            events.push({
                source: 'app_activity',
                type: 'daily_high_usage',
                appName,
                happenedAt: now,
                significance: Math.min(
                    0.92,
                    0.62 + totalMs / (24 * ONE_HOUR)
                ),
                expiresAt: endOfToday,
                sourceKey:
                    `daily_high_usage|${appName}|${dayKey}|1h`,
                summary:
                    `今天 ${appName} 的累计使用已达到约 ` +
                    `${this.formatDuration(totalMs)}。`,
                payload: {
                    appName,
                    totalMs,
                    dayKey
                }
            });
        }

        return events
            .filter(event => event.expiresAt > now)
            .sort((a, b) =>
                b.significance - a.significance ||
                b.happenedAt - a.happenedAt
            );
    },

    async getPendingProactiveActivityEvents(characterId) {
        return window.UwUEventBus?.getPendingEvents(characterId) || [];
    },

    markProactiveActivityEventHandled(
        event,
        characterId,
        decision
    ) {
        window.UwUEventBus?.markHandled(
            event,
            characterId,
            decision
        );
    },

    deferProactiveActivityEvent(event, characterId) {
        window.UwUEventBus?.defer(event, characterId);
    },


    async refreshPassiveContext() {
        try {
            const [passiveContext, digestContext] =
                await Promise.all([
                    this.getPassiveActivityContext(),
                    this.getActivityDigestContext()
                ]);

            this.cachedPassiveContext =
                [passiveContext, digestContext]
                    .filter(Boolean)
                    .join('\n');

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

window.UwUEventBus?.registerProducer(
    'app_activity',
    () => window.UwUAppUsage.getProactiveActivityEvents()
);

// =========================================================
// UwU 前后台边界
//
// 一旦 UwU 离开前台，结束“本次回来”的活动背景。
// 下一次回到 UwU 后，由下一轮 AI 生成前重新建立。
// =========================================================

(() => {
    const usage = window.UwUAppUsage;

    if (!usage || usage.lifecycleListenersReady) return;

    usage.lifecycleListenersReady = true;

    const enterBackground = () => {
        usage.clearVisitActivityContext();
    };

    const enterForeground = () => {
        // 不在恢复前台时读取文件；下一轮私聊生成前按需建立，
        // 避免生命周期回调额外阻塞界面。
        usage.visitActivityContextReady = false;
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            enterBackground();
        } else if (document.visibilityState === 'visible') {
            enterForeground();
        }
    });

    const App = window.Capacitor?.Plugins?.App;

    if (App?.addListener) {
        App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
                enterForeground();
            } else {
                enterBackground();
            }
        }).catch(error => {
            console.warn(
                '[UwU AppUsage] 注册 App 生命周期监听失败：',
                error
            );
        });
    }
})();
