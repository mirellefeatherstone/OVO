// =========================================================
// UwU · iOS 原生本地备份 v0.3
// 与 UwU 原有 .ee 完整备份格式兼容
// =========================================================
// =========================================================
// 备份保留策略
// 只保留最近 7 份 UwU 自动生成的 .ee
// =========================================================

async function uwuCleanupOldNativeBackups(keep = 7) {
    const Filesystem =
        window.Capacitor?.Plugins?.Filesystem;

    if (!Filesystem) return;

    try {
        const result = await Filesystem.readdir({
            path: 'UwU Backups',
            directory: 'DOCUMENTS'
        });

        const backups = (result.files || [])
            .map(file => file.name)
            .filter(name =>
                /^UwU_Backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.ee$/.test(name)
            )
            .sort()
            .reverse();

        const oldBackups = backups.slice(keep);

        for (const name of oldBackups) {
            await Filesystem.deleteFile({
                path: `UwU Backups/${name}`,
                directory: 'DOCUMENTS'
            });

            console.log(
                '[UwU Backup] 已删除旧备份：',
                name
            );
        }

        console.log(
            `[UwU Backup] 备份清理完成，当前保留 ${Math.min(backups.length, keep)} 份`
        );

    } catch (error) {
        console.warn(
            '[UwU Backup] 清理旧备份失败：',
            error
        );
    }
}
window.uwuNativeBackup = {

    async backupNow() {
        if (!window.Capacitor?.isNativePlatform?.()) {
            console.log('[UwU Backup] 当前不是原生 App，跳过');
            return false;
        }

        const Filesystem = window.Capacitor?.Plugins?.Filesystem;

        if (!Filesystem) {
            console.error('[UwU Backup] 找不到 Filesystem 插件');
            if (typeof showToast === 'function') {
                showToast('找不到原生备份插件');
            }
            return false;
        }

        if (typeof createFullBackupData !== 'function') {
            console.error('[UwU Backup] 找不到 createFullBackupData()');
            if (typeof showToast === 'function') {
                showToast('找不到 UwU 完整备份功能');
            }
            return false;
        }

        try {
            console.log('[UwU Backup] 开始生成完整 .ee 备份...');

            // 直接复用 UwU 原版完整备份结构
            const backupData = await createFullBackupData();
            const json = JSON.stringify(backupData);

            // UwU 原版 .ee = JSON → gzip
            const sourceBlob = new Blob(
                [json],
                { type: 'application/json' }
            );

            const compressionStream =
                new CompressionStream('gzip');

            const compressedStream =
                sourceBlob.stream().pipeThrough(compressionStream);

            const compressedBlob =
                await new Response(compressedStream).blob();

            // Capacitor Filesystem 写二进制时传 Base64
            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();

                reader.onloadend = () => {
                    try {
                        resolve(
                            String(reader.result).split(',')[1]
                        );
                    } catch (error) {
                        reject(error);
                    }
                };

                reader.onerror = reject;
                reader.readAsDataURL(compressedBlob);
            });

            const now = new Date();

            const timestamp =
                now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0') + '_' +
                String(now.getHours()).padStart(2, '0') + '-' +
                String(now.getMinutes()).padStart(2, '0') + '-' +
                String(now.getSeconds()).padStart(2, '0');

            const filename =
                `UwU_Backup_${timestamp}.ee`;

            const path =
                `UwU Backups/${filename}`;

            const result = await Filesystem.writeFile({
                path,
                data: base64,
                directory: 'DOCUMENTS',
                recursive: true
            });

            console.log('[UwU Backup] .ee 备份成功', {
                path,
                uri: result.uri,
                originalSize: json.length,
                compressedSize: compressedBlob.size
            });

            if (typeof showToast === 'function') {
                showToast('UwU 已完成 .ee 本地备份 ✓');
            }
            await uwuCleanupOldNativeBackups(7);
            return {
                success: true,
                path,
                uri: result.uri,
                size: compressedBlob.size
            };

        } catch (error) {
            console.error('[UwU Backup] 备份失败：', error);

            if (typeof showToast === 'function') {
                showToast('UwU 本地备份失败');
            }

            return false;
        }
    }
};


// =========================================================
// 自动备份规则
// App 启动 / 重新回到前台时检查
// 距离上次成功备份超过 24 小时才执行
// =========================================================

const UWU_NATIVE_BACKUP_INTERVAL =
    24 * 60 * 60 * 1000;

async function uwuAutoBackupIfNeeded() {
    if (!window.Capacitor?.isNativePlatform?.()) {
        return;
    }

    const lastBackup =
        Number(
            localStorage.getItem(
                'uwu_native_backup_last_success'
            )
        ) || 0;

    const now = Date.now();

    if (
        lastBackup &&
        now - lastBackup < UWU_NATIVE_BACKUP_INTERVAL
    ) {
        console.log(
            '[UwU Backup] 距离上次备份不足 24 小时，本次跳过'
        );
        return;
    }

    const result =
        await window.uwuNativeBackup.backupNow();

    if (result?.success) {
        localStorage.setItem(
            'uwu_native_backup_last_success',
            String(Date.now())
        );

        console.log(
            '[UwU Backup] 已记录本次自动备份时间'
        );
    }
}


// App 第一次启动
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        uwuAutoBackupIfNeeded();
    }, 2000);
});


// App 从后台重新回到前台
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        setTimeout(() => {
            uwuAutoBackupIfNeeded();
        }, 1000);
    }
});
