const Capacitor = window.Capacitor;

if (Capacitor?.isNativePlatform?.()) {
    const { Filesystem, Share } = Capacitor.Plugins;
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    const objectUrlBlobs = new Map();

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    function cleanFilename(filename) {
        return String(filename || `UwU_导出_${Date.now()}`)
            .replace(/[\\/:*?"<>|]/g, '_');
    }

    async function exportBlob(blob, filename) {
        const safeFilename = cleanFilename(filename);
        const path = `UwU Exports/${Date.now()}_${safeFilename}`;
        const data = await blobToBase64(blob);
        const result = await Filesystem.writeFile({
            path,
            data,
            directory: 'CACHE',
            recursive: true,
        });

        try {
            await Share.share({
                title: safeFilename,
                dialogTitle: '导出 UwU 文件',
                url: result.uri,
            });
        } finally {
            await Filesystem.deleteFile({ path, directory: 'CACHE' });
        }
    }

    async function getDownloadBlob(anchor) {
        const blob = objectUrlBlobs.get(anchor.href);
        if (blob) return blob;
        return (await fetch(anchor.href)).blob();
    }

    URL.createObjectURL = function createTrackedObjectURL(object) {
        const url = originalCreateObjectURL(object);
        if (object instanceof Blob) objectUrlBlobs.set(url, object);
        return url;
    };

    URL.revokeObjectURL = function revokeTrackedObjectURL(url) {
        objectUrlBlobs.delete(String(url));
        originalRevokeObjectURL(url);
    };

    HTMLAnchorElement.prototype.click = function nativeFileExportClick() {
        if (!this.download) return originalAnchorClick.call(this);

        const anchor = this;
        const pendingExport = getDownloadBlob(anchor).then(blob => {
            return exportBlob(blob, anchor.download);
        });
        pendingExport.catch(error => {
            console.error('[UwU Export] 导出失败:', error);
            window.showToast?.(`导出失败: ${error.message}`);
        });

        window.dispatchEvent(new CustomEvent('uwu:native-export', {
            detail: { pendingExport },
        }));
        return pendingExport;
    };

    window.UwUFileExport = { exportBlob };
}
