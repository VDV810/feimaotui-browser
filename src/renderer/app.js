// 全局状态
const appState = {
    tabs: new Map(),
    activeTabId: null,
    downloads: new Map(),
    mediaUrls: new Map(),
    mediaDownloads: new Map(),
    settings: {},
    showCompletedOnly: false,
    panels: {
        download: false,
        media: false,
        bookmark: false,
        history: false,
        translate: false,
        log: false,
        settings: false
    },
    bookmarks: [],
    dragSrcEl: null,
    dragSrcIndex: null,
    tabDragId: null,
    zoomLevels: new Map(),
    contextMenuVisible: false,
    downloadContextMenuTarget: null,
    mediaRoughNaming: true,
    autoSniffActive: false,       // 自动嗅探是否激活
    autoSniffMode: 'idle',        // idle | marking | scrolling | confirming | marking-page | auto-scrolling
    autoSniffStartPos: null,      // 嗅探起始坐标 {x, y}
    autoSniffPagePos: null,       // 翻页按钮坐标 {x, y}
    autoSniffScrollTimer: null,   // 滚动定时器
    autoSniffLastSniffCount: 0,  // 上次检测到的嗅探数量

};

// DOM 元素
const elements = {
    tabsContainer: document.getElementById('tabsContainer'),
    addressInput: document.getElementById('addressInput'),
    backBtn: document.getElementById('backBtn'),
    forwardBtn: document.getElementById('forwardBtn'),
    reloadBtn: document.getElementById('reloadBtn'),
    homeBtn: document.getElementById('homeBtn'),
    newTabBtn: document.getElementById('newTabBtn'),
    bookmarkPageBtn: document.getElementById('bookmarkPageBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    mediaBtn: document.getElementById('mediaBtn'),
    bookmarkManagerBtn: document.getElementById('bookmarkManagerBtn'),
    historyBtn: document.getElementById('historyBtn'),
    translateBtn: document.getElementById('translateBtn'),
    logBtn: document.getElementById('logBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    downloadBadge: document.getElementById('downloadBadge'),
    mediaBadge: document.getElementById('mediaBadge'),
    downloadPanel: document.getElementById('downloadPanel'),
    mediaPanel: document.getElementById('mediaPanel'),
    bookmarkPanel: document.getElementById('bookmarkPanel'),
    historyPanel: document.getElementById('historyPanel'),
    translatePanel: document.getElementById('translatePanel'),
    logPanel: document.getElementById('logPanel'),
    settingsPanel: document.getElementById('settingsPanel'),
    downloadList: document.getElementById('downloadList'),
    mediaList: document.getElementById('mediaList'),
    bookmarkList: document.getElementById('bookmarkList'),
    historyList: document.getElementById('historyList'),
    logContent: document.getElementById('logContent'),
    welcomePage: document.getElementById('welcomePage'),
    closeDownloadPanel: document.getElementById('closeDownloadPanel'),
    closeMediaPanel: document.getElementById('closeMediaPanel'),
    closeBookmarkPanel: document.getElementById('closeBookmarkPanel'),
    closeHistoryPanel: document.getElementById('closeHistoryPanel'),
    closeTranslatePanel: document.getElementById('closeTranslatePanel'),
    closeLogPanel: document.getElementById('closeLogPanel'),
    closeSettingsPanel: document.getElementById('closeSettingsPanel'),
    homepageInput: document.getElementById('homepageInput'),
    searchEngineSelect: document.getElementById('searchEngineSelect'),
    downloadPathInput: document.getElementById('downloadPathInput'),
    fontSizeRange: document.getElementById('fontSizeRange'),
    fontSizeValue: document.getElementById('fontSizeValue'),
    adblockCheckbox: document.getElementById('adblockCheckbox'),
    darkModeCheckbox: document.getElementById('darkModeCheckbox'),
    autoTranslateCheckbox: document.getElementById('autoTranslateCheckbox'),
    alwaysTranslateNonCjkCheckbox: document.getElementById('alwaysTranslateNonCjkCheckbox'),
    selectDownloadPathBtn: document.getElementById('selectDownloadPathBtn'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    customAdRulesList: document.getElementById('customAdRulesList'),
    clearAllAdRulesBtn: document.getElementById('clearAllAdRulesBtn'),
    exportBookmarksBtn: document.getElementById('exportBookmarksBtn'),
    importBookmarksBtn: document.getElementById('importBookmarksBtn'),
    appVersion: document.getElementById('appVersion'),
    electronVersion: document.getElementById('electronVersion'),
    chromiumVersion: document.getElementById('chromiumVersion'),
    bookmarkBarContent: document.getElementById('bookmarkBarContent'),
    bookmarkOverflowBtn: document.getElementById('bookmarkOverflowBtn'),
    bookmarkOverflowDropdown: document.getElementById('bookmarkOverflowDropdown'),
    bookmarkOverflowList: document.getElementById('bookmarkOverflowList'),
    translateInput: document.getElementById('translateInput'),
    translateResult: document.getElementById('translateResult'),
    translateTextBtn: document.getElementById('translateTextBtn'),
    translatePageBtn: document.getElementById('translatePageBtn'),
    translateTargetLang: document.getElementById('translateTargetLang'),
    pageTranslateLang: document.getElementById('pageTranslateLang'),
    refreshLogBtn: document.getElementById('refreshLogBtn'),
    copyLogBtn: document.getElementById('copyLogBtn'),
    clearLogBtn: document.getElementById('clearLogBtn'),
    autoClearLogCheckbox: document.getElementById('autoClearLogCheckbox'),
    securityIcon: document.getElementById('securityIcon'),
    pageContextMenu: document.getElementById('pageContextMenu')
};

// 初始化
async function init() {
    console.log('[APP] 初始化开始');
    setupEventListeners();
    setupKeyboardShortcuts();
    setupContextMenu();
    setupZoomControl();
    setupIPCEvents();
    setupBookmarkOverflow();
    initAutoSniffDOM();  // 初始化自动嗅探 DOM
    await createInitialTab();
    await loadBookmarks();
    await loadSettings();
    console.log('[APP] 初始化完成');
}

// 设置事件监听器
function setupEventListeners() {
    // 导航按钮
    if (elements.backBtn) {
        elements.backBtn.addEventListener('click', () => {
            console.log('[APP] 点击后退按钮');
            if (appState.activeTabId) window.electronAPI.goBack(appState.activeTabId);
        });
    }
    if (elements.forwardBtn) {
        elements.forwardBtn.addEventListener('click', () => {
            console.log('[APP] 点击前进按钮');
            if (appState.activeTabId) window.electronAPI.goForward(appState.activeTabId);
        });
    }
    if (elements.reloadBtn) {
        elements.reloadBtn.addEventListener('click', () => {
            console.log('[APP] 点击刷新按钮');
            if (appState.activeTabId) {
                const tab = appState.tabs.get(appState.activeTabId);
                if (tab && tab.loading) {
                    window.electronAPI.stopLoading(appState.activeTabId);
                } else {
                    window.electronAPI.reload(appState.activeTabId);
                }
            }
        });
    }
    if (elements.homeBtn) {
        elements.homeBtn.addEventListener('click', () => {
            console.log('[APP] 点击主页按钮');
            const homepage = appState.settings.homepage || 'https://www.baidu.com';
            if (appState.activeTabId) {
                window.electronAPI.navigateTo(appState.activeTabId, homepage);
            } else {
                createTab(homepage);
            }
        });
    }
    if (elements.newTabBtn) {
        elements.newTabBtn.addEventListener('click', () => {
            console.log('[APP] 点击新建标签页按钮');
            createTab();
        });
    }
    if (elements.bookmarkPageBtn) {
        elements.bookmarkPageBtn.addEventListener('click', async () => {
            console.log('[APP] 点击收藏按钮');
            if (!appState.activeTabId) return;
            const tab = appState.tabs.get(appState.activeTabId);
            if (!tab) return;
            try {
                // 检查是否已收藏（按网址查重）
                const isBookmarked = appState.bookmarks.some(b => b.url === tab.url);
                if (isBookmarked) {
                    // 已收藏 → 取消收藏
                    const existing = appState.bookmarks.find(b => b.url === tab.url);
                    if (existing) {
                        await window.electronAPI.removeBookmark(existing.id);
                        await loadBookmarks();
                        updateBookmarkStar(tab.url);
                    }
                } else {
                    // 未收藏 → 添加收藏
                    await window.electronAPI.addBookmark({ url: tab.url, title: tab.title, folder: '默认文件夹' });
                    await loadBookmarks();
                    updateBookmarkStar(tab.url);
                }
            } catch (e) {
                console.error('收藏操作失败:', e);
            }
        });
    }

    // 地址栏
    if (elements.addressInput) {
        // 点击地址栏自动全选（类似 Edge 浏览器）
        elements.addressInput.addEventListener('click', (e) => {
            e.stopPropagation();
            elements.addressInput.select();
        });
        // 地址栏右键菜单 - 使用原生 Menu（避免被 BrowserView 遮挡）
        elements.addressInput.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const hasSelection = elements.addressInput.selectionStart !== elements.addressInput.selectionEnd;
            if (window.electronAPI.showAddressBarMenu) {
                window.electronAPI.showAddressBarMenu({ hasSelection });
            }
        });
        elements.addressInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const url = elements.addressInput.value.trim();
                if (url) {
                    if (appState.activeTabId) {
                        window.electronAPI.navigateTo(appState.activeTabId, url);
                    } else {
                        createTab(url);
                    }
                }
            }
        });
    }

    // 面板切换 - 关键修复：使用mousedown而不是click，避免被BrowserView拦截
    if (elements.downloadBtn) {
        elements.downloadBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            console.log('[APP] 点击下载按钮');
            togglePanel('download');
        });
    }
    if (elements.mediaBtn) {
        elements.mediaBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            console.log('[APP] 点击媒体按钮');
            togglePanel('media');
        });
    }
    if (elements.bookmarkManagerBtn) {
        elements.bookmarkManagerBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            console.log('[APP] 点击书签管理按钮');
            togglePanel('bookmark');
        });
    }
    if (elements.historyBtn) {
        elements.historyBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            console.log('[APP] 点击历史按钮');
            togglePanel('history');
        });
    }
    if (elements.translateBtn) {
        elements.translateBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            console.log('[APP] 点击翻译按钮');
            togglePanel('translate');
        });
    }
    if (elements.logBtn) {
        elements.logBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            console.log('[APP] 点击日志按钮');
            togglePanel('log');
        });
    }
    if (elements.settingsBtn) {
        elements.settingsBtn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            console.log('[APP] 点击设置按钮');
            togglePanel('settings');
        });
    }

    // 关闭面板
    if (elements.closeDownloadPanel) elements.closeDownloadPanel.addEventListener('click', () => closePanel('download'));
    if (elements.closeMediaPanel) elements.closeMediaPanel.addEventListener('click', () => closePanel('media'));
    if (elements.closeBookmarkPanel) elements.closeBookmarkPanel.addEventListener('click', () => closePanel('bookmark'));
    if (elements.closeHistoryPanel) elements.closeHistoryPanel.addEventListener('click', () => closePanel('history'));
    if (elements.closeTranslatePanel) elements.closeTranslatePanel.addEventListener('click', () => closePanel('translate'));
    if (elements.closeLogPanel) elements.closeLogPanel.addEventListener('click', () => closePanel('log'));
    if (elements.closeSettingsPanel) elements.closeSettingsPanel.addEventListener('click', () => closePanel('settings'));

    // 点击面板外部关闭面板（仅 renderer 自己的工具栏 / 空白 DOM 区域）
    document.addEventListener('mousedown', (e) => {
        // 如果点击的是工具栏按钮，不关闭面板（让按钮自己的事件处理）
        if (e.target.closest('.toolbar-btn')) {
            return;
        }
        // 如果点击的是面板内部，不关闭
        if (e.target.closest('.panel')) {
            return;
        }
        // 否则关闭所有面板
        closeAllPanels();
    });

    // 日志功能
    if (elements.refreshLogBtn) {
        elements.refreshLogBtn.addEventListener('click', loadLogs);
    }
    if (elements.copyLogBtn) {
        elements.copyLogBtn.addEventListener('click', copyLogs);
    }
    if (elements.clearLogBtn) {
        elements.clearLogBtn.addEventListener('click', clearLogs);
    }
    if (elements.autoClearLogCheckbox) {
        elements.autoClearLogCheckbox.addEventListener('change', async () => {
            await window.electronAPI.setLogAutoClear(elements.autoClearLogCheckbox.checked);
        });
    }

    // 快速链接
    document.querySelectorAll('.quick-link').forEach(link => {
        link.addEventListener('click', () => {
            const url = link.dataset.url;
            if (url) createTab(url);
        });
    });

    // 设置
    if (elements.homepageInput) {
        elements.homepageInput.addEventListener('change', updateSettings);
    }
    if (elements.searchEngineSelect) {
        elements.searchEngineSelect.addEventListener('change', updateSettings);
    }
    if (elements.adblockCheckbox) {
        elements.adblockCheckbox.addEventListener('change', updateSettings);
    }
    if (elements.darkModeCheckbox) {
        elements.darkModeCheckbox.addEventListener('change', updateSettings);
    }
    if (elements.autoTranslateCheckbox) {
        elements.autoTranslateCheckbox.addEventListener('change', updateSettings);
    }
    if (elements.alwaysTranslateNonCjkCheckbox) {
        elements.alwaysTranslateNonCjkCheckbox.addEventListener('change', updateSettings);
    }
    if (elements.fontSizeRange) {
        elements.fontSizeRange.addEventListener('input', () => {
            applyFontSize(elements.fontSizeRange.value);
        });
        elements.fontSizeRange.addEventListener('change', updateSettings);
    }

    if (elements.selectDownloadPathBtn) {
        elements.selectDownloadPathBtn.addEventListener('click', async () => {
            const path = await window.electronAPI.selectDownloadPath();
            if (path) {
                elements.downloadPathInput.value = path;
                updateSettings();
            }
        });
    }

    if (elements.clearHistoryBtn) {
        elements.clearHistoryBtn.addEventListener('click', async () => {
            await window.electronAPI.clearHistory();
            loadHistory();
        });
    }

    if (elements.clearAllAdRulesBtn) {
        elements.clearAllAdRulesBtn.addEventListener('click', async () => {
            if (confirm('确定要清空所有已标记的广告元素吗？')) {
                await window.electronAPI.clearCustomAdRules();
                await loadCustomAdRules();
            }
        });
    }

    // 导出书签
    if (elements.exportBookmarksBtn) {
        elements.exportBookmarksBtn.addEventListener('click', async () => {
            try {
                const result = await window.electronAPI.exportBookmarks();
                if (result.success) {
                    alert(`书签导出成功！共 ${result.count} 个书签`);
                } else if (!result.canceled) {
                    alert(`导出失败：${result.error || '未知错误'}`);
                }
            } catch (e) {
                alert('导出书签失败: ' + e.message);
            }
        });
    }

    // 导入书签
    if (elements.importBookmarksBtn) {
        elements.importBookmarksBtn.addEventListener('click', async () => {
            try {
                const result = await window.electronAPI.importBookmarks();
                if (result.success) {
                    await loadBookmarks();
                    alert(`书签导入完成！新增 ${result.added} 个，重复跳过 ${result.duplicated} 个`);
                } else if (!result.canceled) {
                    alert(`导入失败：${result.error || '未知错误'}`);
                }
            } catch (e) {
                alert('导入书签失败: ' + e.message);
            }
        });
    }

    // 翻译功能
    if (elements.translateTextBtn) {
        elements.translateTextBtn.addEventListener('click', async () => {
            const text = elements.translateInput.value.trim();
            if (!text) return;
            elements.translateTextBtn.disabled = true;
            elements.translateTextBtn.textContent = '翻译中...';
            try {
                const targetLang = elements.translateTargetLang.value;
                const result = await window.electronAPI.translateText(text, targetLang);
                if (result.success) {
                    elements.translateResult.value = result.text;
                } else {
                    elements.translateResult.value = '翻译失败: ' + result.error;
                }
            } catch (error) {
                elements.translateResult.value = '翻译失败: ' + error.message;
            } finally {
                elements.translateTextBtn.disabled = false;
                elements.translateTextBtn.textContent = '翻译';
            }
        });
    }

    if (elements.translatePageBtn) {
        elements.translatePageBtn.addEventListener('click', async () => {
            if (!appState.activeTabId) {
                alert('请先打开一个页面');
                return;
            }
            elements.translatePageBtn.disabled = true;
            elements.translatePageBtn.textContent = '翻译中...';
            try {
                const targetLang = elements.pageTranslateLang.value;
                const result = await window.electronAPI.translatePage(appState.activeTabId, targetLang);
                if (result.success) {
                    alert(`页面翻译完成，共翻译 ${result.translatedCount} 处文本`);
                } else {
                    alert('页面翻译失败: ' + result.error);
                }
            } catch (error) {
                alert('页面翻译失败: ' + error.message);
            } finally {
                elements.translatePageBtn.disabled = false;
                elements.translatePageBtn.textContent = '翻译当前页面';
            }
        });
    }
}

// 键盘快捷键
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // F5 刷新
        if (e.key === 'F5') {
            e.preventDefault();
            if (appState.activeTabId) {
                window.electronAPI.reload(appState.activeTabId);
            }
        }
        // Ctrl+T 新建标签页
        if (e.ctrlKey && e.key === 't') {
            e.preventDefault();
            createTab();
        }
        // Ctrl+W 关闭标签页
        if (e.ctrlKey && e.key === 'w') {
            e.preventDefault();
            if (appState.activeTabId) {
                closeTab(appState.activeTabId);
            }
        }
        // Ctrl+L 聚焦地址栏
        if (e.ctrlKey && e.key === 'l') {
            e.preventDefault();
            if (elements.addressInput) {
                elements.addressInput.focus();
                elements.addressInput.select();
            }
        }
        // Ctrl+0 重置当前网页缩放，解决单个页面被放大后缩不回来的问题
        if (e.ctrlKey && e.key === '0') {
            e.preventDefault();
            if (appState.activeTabId && window.electronAPI.resetZoomLevel) {
                appState.zoomLevels.set(appState.activeTabId, 0);
                window.electronAPI.resetZoomLevel(appState.activeTabId);
            }
        }
    });
}

// 右键菜单：网页区域右键统一由主进程原生 Menu 处理，renderer 不再显示 DOM 菜单
// 避免 BrowserView 原生层和 DOM 层同时弹出两个菜单
function setupContextMenu() {
    // 下载/嗅探列表的右键在各自渲染函数中处理（调用 IPC 弹出原生菜单）
    // 网页区域的右键由 main.js 中的 BrowserView context-menu 事件处理
    // 这里不再监听 document 的 contextmenu，彻底避免双菜单
}

function ensureDownloadContextMenu() {
    let menu = document.getElementById('downloadContextMenu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'downloadContextMenu';
        menu.className = 'context-menu download-context-menu';
        document.documentElement.appendChild(menu);
    }
    return menu;
}

function buildDownloadContextMenuItems(download) {
    const items = [];
    if (download.state === 'progressing') {
        items.push({ action: download.paused ? 'resume' : 'pause', label: download.paused ? '继续下载' : '暂停' });
    }
    if (download.state !== 'progressing') {
        items.push({ action: 'redownload', label: '重新下载' });
    }
    if (download.filePath) {
        items.push({ action: 'folder', label: '打开文件夹' });
    }
    items.push({ action: 'delete', label: '删除', danger: true });
    return items;
}

function showDownloadContextMenu(event, download, source = 'download') {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    hideContextMenu();
    hideDownloadContextMenu();
    const menu = ensureDownloadContextMenu();
    appState.downloadContextMenuTarget = { download, source };
    menu.innerHTML = buildDownloadContextMenuItems(download).map(item => `
        <div class="context-menu-item ${item.danger ? 'danger' : ''}" data-download-context-action="${item.action}">
            <span>${item.label}</span>
        </div>
    `).join('');
    menu.querySelectorAll('[data-download-context-action]').forEach(item => {
        item.addEventListener('click', async (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
            await handleDownloadContextAction(item.dataset.downloadContextAction);
            hideDownloadContextMenu({ preservePanel: true });
        });
    });
    menu.style.visibility = 'hidden';
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.classList.add('show');
    const rect = menu.getBoundingClientRect();
    let posX = event.clientX;
    let posY = event.clientY;
    if (posX + rect.width > window.innerWidth) posX = window.innerWidth - rect.width - 12;
    if (posY + rect.height > window.innerHeight) posY = window.innerHeight - rect.height - 12;
    menu.style.left = `${Math.max(8, posX)}px`;
    menu.style.top = `${Math.max(8, posY)}px`;
    menu.style.visibility = 'visible';
}

function hideDownloadContextMenu(options = {}) {
    const menu = document.getElementById('downloadContextMenu');
    if (menu) menu.classList.remove('show');
    appState.downloadContextMenuTarget = null;
}

async function refreshCurrentDownloadPanel() {
    const target = appState.downloadContextMenuTarget;
    if (target && target.source === 'media') await renderMediaList();
    else await renderDownloadList();
}

async function handleDownloadContextAction(action) {
    const target = appState.downloadContextMenuTarget;
    if (!target || !target.download) return;
    const download = target.download;
    if (action === 'pause') {
        await pauseDownload(download.id);
        await refreshCurrentDownloadPanel();
        return;
    }
    if (action === 'resume') {
        await resumeDownload(download.id);
        await refreshCurrentDownloadPanel();
        return;
    }
    if (action === 'redownload') {
        const result = await window.electronAPI.redownload(download);
        if (!result || !result.success) alert(`重新下载失败：${result && result.error ? result.error : '未知错误'}`);
        await refreshCurrentDownloadPanel();
        return;
    }
    if (action === 'folder') {
        await showInFolder(download.filePath || '');
        await refreshCurrentDownloadPanel();
        return;
    }
    if (action === 'delete') {
        await removeDownloadRecord(download.id);
        await refreshCurrentDownloadPanel();
    }
}

// 来自主进程原生 Menu 的回调
async function handleDownloadContextActionFromMain(data) {
    if (!data || !data.action) return;
    const { action, downloadId, source } = data;
    // 处理未下载媒体的右键操作
    if (source === 'media-undownloaded') {
        const target = appState.downloadContextMenuTarget;
        if (action === 'download') {
            if (target && target.mediaUrl) {
                await downloadMedia(target.mediaUrl, target.mediaTitle || getFileNameFromUrl(target.mediaUrl));
                await renderMediaList();
            }
            return;
        }
        if (action === 'delete') {
            // 从嗅探列表中删除未下载的媒体
            if (target && target.mediaUrl) {
                appState.mediaUrls.forEach((list, tabId) => {
                    const filtered = list.filter(m => m.url !== target.mediaUrl);
                    appState.mediaUrls.set(tabId, filtered);
                });
                if (window.electronAPI.deleteMediaUrl) {
                    await window.electronAPI.deleteMediaUrl(null, target.mediaUrl);
                }
                await renderMediaList();
            }
            return;
        }
        return;
    }
    // 根据 downloadId 找到对应的下载项
    let download = appState.downloads.get(downloadId);
    if (!download && source === 'media') {
        for (const md of appState.mediaDownloads.values()) {
            if (md.id === downloadId) { download = md; break; }
        }
    }
    if (!download) return;
    appState.downloadContextMenuTarget = { download, source };
    if (action === 'pause') {
        await pauseDownload(download.id);
    } else if (action === 'resume') {
        await resumeDownload(download.id);
    } else if (action === 'redownload') {
        const result = await window.electronAPI.redownload(download);
        if (!result || !result.success) alert(`重新下载失败：${result && result.error ? result.error : '未知错误'}`);
    } else if (action === 'delete') {
        await removeDownloadRecord(download.id);
    }
    if (source === 'media') await renderMediaList();
    else await renderDownloadList();
}

async function handleContextMenuAction(action) {
    if (!appState.activeTabId) return;

    switch (action) {
        case 'back':
            window.electronAPI.goBack(appState.activeTabId);
            break;
        case 'forward':
            window.electronAPI.goForward(appState.activeTabId);
            break;
        case 'reload':
            window.electronAPI.reload(appState.activeTabId);
            break;
        case 'print':
            try {
                const result = await window.electronAPI.printPage(appState.activeTabId);
                if (!result.success) console.error('打印失败:', result.error);
            } catch (e) {
                console.error('打印失败:', e);
            }
            break;
        case 'screenshot':
            try {
                const result = await window.electronAPI.capturePage(appState.activeTabId);
                if (result.success) {
                    alert('截图已保存到: ' + result.filePath);
                } else {
                    alert('截图失败: ' + result.error);
                }
            } catch (e) {
                alert('截图失败: ' + e.message);
            }
            break;
    }
}

// Ctrl+滚轮缩放 - 关键修复：监听window的wheel事件
function setupZoomControl() {
    window.addEventListener('wheel', async (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            e.stopPropagation();
            if (!appState.activeTabId) return;

            const delta = e.deltaY > 0 ? -0.5 : 0.5;
            let currentLevel = appState.zoomLevels.get(appState.activeTabId) || 0;
            currentLevel += delta;
            // 限制缩放范围 -3 到 3
            currentLevel = Math.max(-3, Math.min(3, currentLevel));
            appState.zoomLevels.set(appState.activeTabId, currentLevel);

            try {
                await window.electronAPI.setZoomLevel(appState.activeTabId, currentLevel);
                console.log('[APP] 页面缩放:', currentLevel);
            } catch (err) {
                console.error('缩放失败:', err);
            }
        }
    }, { passive: false, capture: true });
}

// 设置IPC事件
function setupIPCEvents() {
    window.electronAPI.onTabCreated((data) => {
        const newTab = {
            id: data.id, url: data.url, title: data.title,
            favicon: null, loading: false, canGoBack: false, canGoForward: false, active: data.active
        };
        // 如果有父标签，将新标签插入到父标签右侧
        if (data.openerTabId && appState.tabs.has(data.openerTabId)) {
            const newTabs = new Map();
            for (const [key, value] of appState.tabs) {
                newTabs.set(key, value);
                if (key === data.openerTabId) {
                    newTabs.set(data.id, newTab);
                }
            }
            appState.tabs = newTabs;
        } else {
            appState.tabs.set(data.id, newTab);
        }
        if (data.active) appState.activeTabId = data.id;
        renderTabs();
        updateUI();
    });

    window.electronAPI.onTabClosed((data) => {
        appState.tabs.delete(data.tabId);
        appState.mediaUrls.delete(data.tabId);
        appState.zoomLevels.delete(data.tabId);
        if (appState.activeTabId === data.tabId) {
            const remaining = Array.from(appState.tabs.keys());
            if (remaining.length > 0) {
                appState.activeTabId = remaining[0];
                window.electronAPI.activateTab(appState.activeTabId);
            } else {
                appState.activeTabId = null;
                if (elements.welcomePage) elements.welcomePage.style.display = 'flex';
            }
        }
        renderTabs();
        updateUI();
    });

    window.electronAPI.onTabActivated((data) => {
        appState.activeTabId = data.tabId;
        appState.tabs.forEach(tab => { tab.active = tab.id === data.tabId; });
        renderTabs();
        updateUI();
        const tab = appState.tabs.get(data.tabId);
        if (tab) updateBookmarkStar(tab.url);
    });

    window.electronAPI.onTabUpdated((data) => {
        const tab = appState.tabs.get(data.tabId);
        if (tab) {
            Object.assign(tab, data);
            renderTabs();
            updateUI();
            if (data.url && tab.id === appState.activeTabId) updateBookmarkStar(data.url);
            if (data.title && !appState.settings.autoTranslateChecked) {
                checkAutoTranslate(data.tabId, data.url, data.title);
            }
        }
    });

    window.electronAPI.onMediaDetected((data) => {
        if (!appState.mediaUrls.has(data.tabId)) appState.mediaUrls.set(data.tabId, []);
        const list = appState.mediaUrls.get(data.tabId);
        if (!list.some(m => m.url === data.media.url)) {
            list.push(data.media);
            updateMediaBadge();
            if (appState.panels.media) renderMediaList();
        }
    });

    if (window.electronAPI.onMediaDownloadStarted) {
        window.electronAPI.onMediaDownloadStarted((data) => {
            appState.mediaDownloads.set(data.mediaUrl || data.url, data);
            if (appState.panels.media) renderMediaList();
        });
    }

    if (window.electronAPI.onMediaDownloadProgress) {
        window.electronAPI.onMediaDownloadProgress((data) => {
            appState.mediaDownloads.set(data.mediaUrl || data.url, data);
            if (appState.panels.media) renderMediaList();
        });
    }

    if (window.electronAPI.onMediaDownloadCompleted) {
        window.electronAPI.onMediaDownloadCompleted((data) => {
            appState.mediaDownloads.set(data.mediaUrl || data.url, data);
            appState.downloads.delete(data.id);
            if (appState.panels.media) renderMediaList();
            if (appState.panels.download) renderDownloadList();
            updateDownloadBadge();
            updateMediaBadge();
        });
    }

    window.electronAPI.onDownloadStarted((data) => {
        if (isMediaDownloadRecord(data)) return;
        appState.downloads.set(data.id, data);
        updateDownloadBadge();
        if (appState.panels.download) renderDownloadList();
    });

    window.electronAPI.onDownloadProgress((data) => {
        if (isMediaDownloadRecord(data)) return;
        appState.downloads.set(data.id, data);
        if (appState.panels.download) renderDownloadList();
    });

    window.electronAPI.onDownloadCompleted((data) => {
        if (isMediaDownloadRecord(data)) return;
        appState.downloads.set(data.id, data);
        updateDownloadBadge();
        if (appState.panels.download) renderDownloadList();
    });

    if (window.electronAPI.onDownloadDeleted) {
        window.electronAPI.onDownloadDeleted((data) => {
            appState.downloads.delete(data.id);
            updateDownloadBadge();
            if (appState.panels.download) renderDownloadList();
        });
    }

    if (window.electronAPI.onDownloadRecordsCleared) {
        window.electronAPI.onDownloadRecordsCleared(() => {
            appState.downloads.forEach((download, id) => {
                if (download.state !== 'progressing') appState.downloads.delete(id);
            });
            updateDownloadBadge();
            if (appState.panels.download) renderDownloadList();
        });
    }

    if (window.electronAPI.onMediaListCleared) {
        window.electronAPI.onMediaListCleared(() => {
            appState.mediaUrls.clear();
            appState.mediaDownloads.forEach((download, url) => {
                if (download.state !== 'progressing') appState.mediaDownloads.delete(url);
            });
            updateMediaBadge();
            if (appState.panels.media) renderMediaList();
        });
    }

    if (window.electronAPI.onBookmarksChanged) {
        window.electronAPI.onBookmarksChanged(() => {
            loadBookmarks();
        });
    }

    // 拖入书签文件导入完成
    if (window.electronAPI.onBookmarksImported) {
        window.electronAPI.onBookmarksImported((data) => {
            loadBookmarks();
            if (data && data.added > 0) {
                // 使用 toast 提示而不是 alert
                const toast = document.createElement('div');
                toast.className = 'toast-notification';
                toast.textContent = `拖入导入书签完成：新增 ${data.added} 个，重复跳过 ${data.duplicated || 0} 个`;
                document.body.appendChild(toast);
                setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
            }
        });
    }

    // BrowserView 是原生网页层，点击网页内容区不会触发上面的 document.mousedown。
    // 主进程捕获 BrowserView 的 mouseDown 后发回此事件，用统一逻辑关闭右侧面板。
    if (window.electronAPI.onBrowserViewClicked) {
        window.electronAPI.onBrowserViewClicked(() => {
            closeAllPanels();
        });
    }

    // 下载/嗅探列表右键菜单动作回调（来自主进程原生 Menu）
    if (window.electronAPI.onDownloadContextAction) {
        window.electronAPI.onDownloadContextAction((data) => {
            handleDownloadContextActionFromMain(data);
        });
    }

    // 地址栏右键菜单动作回调（来自主进程原生 Menu）
    if (window.electronAPI.onAddressBarAction) {
        window.electronAPI.onAddressBarAction((data) => {
            if (!data || !data.action) return;
            const { action } = data;
            if (action === 'copy') {
                document.execCommand('copy');
            } else if (action === 'paste') {
                document.execCommand('paste');
            } else if (action === 'cut') {
                document.execCommand('cut');
            } else if (action === 'select-all') {
                elements.addressInput.select();
            } else if (action === 'delete') {
                elements.addressInput.value = '';
                elements.addressInput.focus();
            }
        });
    }

    // 自动嗅探事件
    if (window.electronAPI.onAutoSniffScrollBottom) {
        window.electronAPI.onAutoSniffScrollBottom(() => {
            onAutoSniffScrollBottom();
        });
    }
    if (window.electronAPI.onAutoSniffPageNext) {
        window.electronAPI.onAutoSniffPageNext(() => {
            onAutoSniffPageNext();
        });
    }
    if (window.electronAPI.onAutoSniffCountUpdate) {
        window.electronAPI.onAutoSniffCountUpdate((count) => {
            onAutoSniffCountUpdate(count);
        });
    }
}

// 检测英文网页自动翻译
async function checkAutoTranslate(tabId, url, title) {
    if (!url || url === 'about:blank') return;
    if (appState.settings.autoTranslate === false) return;
    const englishPattern = /^[\x00-\x7F]+$/;
    const hasChinese = /[\u4e00-\u9fff]/.test(title);
    if (englishPattern.test(title) && !hasChinese && title.length > 5) {
        console.log('检测到英文页面，自动翻译:', title);
        try {
            await window.electronAPI.translatePage(tabId, 'zh');
        } catch (e) {
            console.error('自动翻译失败:', e);
        }
    }
}

// 创建初始标签页
async function createInitialTab() {
    try {
        const tabs = await window.electronAPI.getTabs();
        if (tabs.length === 0) {
            await createTab();
        } else {
            tabs.forEach(tab => {
                appState.tabs.set(tab.id, tab);
                if (tab.active) appState.activeTabId = tab.id;
            });
            renderTabs();
            updateUI();
        }
    } catch (error) {
        console.error('创建初始标签页失败:', error);
        await createTab();
    }
}

// 创建标签页
async function createTab(url = null) {
    try {
        const tabId = await window.electronAPI.createTab(url);
        if (elements.welcomePage) elements.welcomePage.style.display = 'none';
        return tabId;
    } catch (error) {
        console.error('创建标签页失败:', error);
    }
}

// 关闭标签页
async function closeTab(tabId) {
    try {
        await window.electronAPI.closeTab(tabId);
    } catch (error) {
        console.error('关闭标签页失败:', error);
    }
}

// 激活标签页
async function activateTab(tabId) {
    try {
        await window.electronAPI.activateTab(tabId);
    } catch (error) {
        console.error('激活标签页失败:', error);
    }
}

// 渲染标签页
function renderTabs() {
    if (!elements.tabsContainer) return;
    elements.tabsContainer.innerHTML = '';
    const tabCount = appState.tabs.size;
    elements.tabsContainer.style.setProperty('--tab-count', tabCount);
    appState.tabs.forEach(tab => {
        const tabElement = document.createElement('div');
        tabElement.className = `tab ${tab.active ? 'active' : ''}`;
        tabElement.dataset.tabId = tab.id;
        tabElement.draggable = true;
        const favicon = tab.favicon ?
            `<img src="${tab.favicon}" class="tab-favicon" alt="">` :
            `<div class="tab-favicon" style="background: var(--primary-color); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">&#127760;</div>`;
        const loadingIndicator = tab.loading ? `<div class="tab-loading"></div>` : '';
        tabElement.innerHTML = `
            ${favicon}
            ${loadingIndicator}
            <span class="tab-title">${escapeHtml(tab.title || '新标签页')}</span>
            <button class="tab-close" data-tab-id="${tab.id}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        tabElement.addEventListener('click', (e) => {
            if (!e.target.closest('.tab-close')) activateTab(tab.id);
        });
        const closeBtn = tabElement.querySelector('.tab-close');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        });
        tabElement.addEventListener('dragstart', handleTabDragStart);
        tabElement.addEventListener('dragover', handleTabDragOver);
        tabElement.addEventListener('dragleave', handleTabDragLeave);
        tabElement.addEventListener('drop', handleTabDrop);
        tabElement.addEventListener('dragend', handleTabDragEnd);
        elements.tabsContainer.appendChild(tabElement);
    });
}

function getOrderedTabIds() {
    return Array.from(appState.tabs.keys());
}

function rebuildTabsInOrder(tabIds) {
    const orderedTabs = [];
    tabIds.forEach(tabId => {
        const tab = appState.tabs.get(tabId);
        if (tab) orderedTabs.push([tabId, tab]);
    });
    appState.tabs.forEach((tab, tabId) => {
        if (!tabIds.includes(tabId)) orderedTabs.push([tabId, tab]);
    });
    appState.tabs = new Map(orderedTabs);
}

function handleTabDragStart(e) {
    if (e.target.closest('.tab-close')) {
        e.preventDefault();
        return;
    }
    appState.tabDragId = this.dataset.tabId;
    this.classList.add('tab-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', appState.tabDragId);
}

function handleTabDragOver(e) {
    e.preventDefault();
    if (this.dataset.tabId !== appState.tabDragId) {
        this.classList.add('tab-drag-over');
    }
    e.dataTransfer.dropEffect = 'move';
}

function handleTabDragLeave() {
    this.classList.remove('tab-drag-over');
}

async function handleTabDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    this.classList.remove('tab-drag-over');
    const srcId = appState.tabDragId || e.dataTransfer.getData('text/plain');
    const targetId = this.dataset.tabId;
    if (!srcId || !targetId || srcId === targetId) return;

    const tabIds = getOrderedTabIds();
    const srcIndex = tabIds.indexOf(srcId);
    const targetIndex = tabIds.indexOf(targetId);
    if (srcIndex === -1 || targetIndex === -1) return;
    const [moved] = tabIds.splice(srcIndex, 1);
    tabIds.splice(targetIndex, 0, moved);
    rebuildTabsInOrder(tabIds);
    renderTabs();
    if (window.electronAPI && window.electronAPI.reorderTabs) {
        await window.electronAPI.reorderTabs(tabIds);
    }
}

function handleTabDragEnd() {
    document.querySelectorAll('.tab-dragging, .tab-drag-over').forEach(el => {
        el.classList.remove('tab-dragging', 'tab-drag-over');
    });
    appState.tabDragId = null;
}

// 更新UI
function updateUI() {
    const tab = appState.activeTabId ? appState.tabs.get(appState.activeTabId) : null;
    if (tab) {
        elements.addressInput.value = tab.url || '';
        elements.addressInput.placeholder = tab.title || '输入网址或搜索内容...';
    } else {
        elements.addressInput.value = '';
        elements.addressInput.placeholder = '输入网址或搜索内容...';
    }
    elements.backBtn.disabled = !tab || !tab.canGoBack;
    elements.forwardBtn.disabled = !tab || !tab.canGoForward;
    if (tab && tab.loading) {
        elements.reloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"/></svg>`;
        elements.reloadBtn.title = '停止';
    } else {
        elements.reloadBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>`;
        elements.reloadBtn.title = '刷新';
    }
    if (!appState.activeTabId || appState.tabs.size === 0) {
        if (elements.welcomePage) elements.welcomePage.style.display = 'flex';
    } else {
        if (elements.welcomePage) elements.welcomePage.style.display = 'none';
    }
}

// 切换面板
function togglePanel(panelName) {
    const panelMap = {
        'download': { panel: elements.downloadPanel, btn: elements.downloadBtn },
        'media': { panel: elements.mediaPanel, btn: elements.mediaBtn },
        'bookmark': { panel: elements.bookmarkPanel, btn: elements.bookmarkManagerBtn },
        'history': { panel: elements.historyPanel, btn: elements.historyBtn },
        'translate': { panel: elements.translatePanel, btn: elements.translateBtn },
        'log': { panel: elements.logPanel, btn: elements.logBtn },
        'settings': { panel: elements.settingsPanel, btn: elements.settingsBtn }
    };

    const target = panelMap[panelName];
    if (!target || !target.panel) {
        console.error('面板不存在:', panelName);
        return;
    }

    const isCurrentlyOpen = appState.panels[panelName];

    // 先关闭所有面板
    Object.keys(appState.panels).forEach(key => {
        appState.panels[key] = false;
        const p = panelMap[key];
        if (p && p.panel) p.panel.classList.remove('open');
        if (p && p.btn) p.btn.classList.remove('active');
    });

    // 如果当前面板没打开，则打开它
    if (!isCurrentlyOpen) {
        appState.panels[panelName] = true;
        target.panel.classList.add('open');
        target.btn.classList.add('active');

        switch (panelName) {
            case 'download': renderDownloadList(); break;
            case 'media': appState.showCompletedOnly = false; renderMediaList(); break;
            case 'bookmark': loadBookmarks(); break;
            case 'history': loadHistory(); break;
            case 'log': loadLogs(); break;
            case 'settings': loadSettings(); break;
            case 'translate': break;
        }
    }

    syncBrowserViewPanelState();
}

// 关闭面板
function closePanel(panelName) {
    appState.panels[panelName] = false;
    const panelMap = {
        'download': { panel: elements.downloadPanel, btn: elements.downloadBtn },
        'media': { panel: elements.mediaPanel, btn: elements.mediaBtn },
        'bookmark': { panel: elements.bookmarkPanel, btn: elements.bookmarkManagerBtn },
        'history': { panel: elements.historyPanel, btn: elements.historyBtn },
        'translate': { panel: elements.translatePanel, btn: elements.translateBtn },
        'log': { panel: elements.logPanel, btn: elements.logBtn },
        'settings': { panel: elements.settingsPanel, btn: elements.settingsBtn }
    };
    const p = panelMap[panelName];
    if (p && p.panel) p.panel.classList.remove('open');
    if (p && p.btn) p.btn.classList.remove('active');
    syncBrowserViewPanelState();
}

// 关闭全部右侧面板
function closeAllPanels() {
    const panelMap = {
        'download': { panel: elements.downloadPanel, btn: elements.downloadBtn },
        'media': { panel: elements.mediaPanel, btn: elements.mediaBtn },
        'bookmark': { panel: elements.bookmarkPanel, btn: elements.bookmarkManagerBtn },
        'history': { panel: elements.historyPanel, btn: elements.historyBtn },
        'translate': { panel: elements.translatePanel, btn: elements.translateBtn },
        'log': { panel: elements.logPanel, btn: elements.logBtn },
        'settings': { panel: elements.settingsPanel, btn: elements.settingsBtn }
    };
    Object.keys(appState.panels).forEach(key => {
        appState.panels[key] = false;
        const p = panelMap[key];
        if (p && p.panel) p.panel.classList.remove('open');
        if (p && p.btn) p.btn.classList.remove('active');
    });
    syncBrowserViewPanelState();
}

function syncBrowserViewPanelState() {
    const isOpen = Object.values(appState.panels).some(Boolean);
    if (window.electronAPI && window.electronAPI.setPanelOpen) {
        window.electronAPI.setPanelOpen(isOpen).catch(error => {
            console.error('同步面板状态失败:', error);
        });
    }
}

// 渲染下载列表
async function loadDownloadRecords() {
    if (!window.electronAPI.getDownloads) return;
    const downloads = await window.electronAPI.getDownloads();
    appState.downloads.clear();
    (downloads || []).forEach(download => {
        if (download && download.id) appState.downloads.set(download.id, download);
    });
    updateDownloadBadge();
}

async function renderDownloadList() {
    if (!elements.downloadList) return;
    await loadDownloadRecords();
    let downloads = Array.from(appState.downloads.values()).filter(download => !isMediaDownloadRecord(download));
    // 按时间从新到旧排序
    downloads.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    if (downloads.length === 0) {
        elements.downloadList.innerHTML = '<div class="empty-state">暂无下载任务</div>';
        return;
    }
    elements.downloadList.innerHTML = `
        <div class="download-toolbar">
            <button class="download-clear-records" onclick="clearDownloadRecords()">一键清除记录</button>
        </div>
        ${downloads.map(download => {
        const progress = download.totalBytes > 0 ? Math.round((download.receivedBytes / download.totalBytes) * 100) : 0;
        const sizeText = download.totalBytes > 0 ? `${formatBytes(download.receivedBytes)} / ${formatBytes(download.totalBytes)}` : formatBytes(download.receivedBytes);
        let statusIcon = download.state === 'completed' ? '&#10003;' : download.state === 'cancelled' ? '&#10007;' : download.state === 'interrupted' ? '!' : '&#11015;';
        const safeFilePath = escapeHtml(JSON.stringify(download.filePath || ''));
        const safeDownloadId = escapeHtml(download.id || '');
        const timeText = download.startTime ? formatTime(download.startTime) : '';
        return `
            <div class="download-item" data-download-context-id="${safeDownloadId}">
                <div class="download-icon">${statusIcon}</div>
                <div class="download-info">
                    <div class="download-name">${escapeHtml(download.fileName)}</div>
                    <div class="download-meta">
                        <span class="download-time">${timeText}</span>
                    </div>
                    <div class="download-progress">
                        <div class="progress-bar"><div class="progress-fill" style="width: ${progress}%"></div></div>
                        <span class="download-size">${sizeText}</span>
                    </div>
                </div>
                <div class="download-actions">
                    ${download.state === 'completed' ? `
                        <button class="download-action-btn" data-action="folder" data-file-path='${safeFilePath}' title="打开文件所在文件夹">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                        </button>
                    ` : ''}
                    ${download.filePath ? `
                        <button class="download-action-btn danger" data-action="delete" data-download-id="${safeDownloadId}" data-file-path='${safeFilePath}' title="删除文件">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('')}
    `;
    setupDownloadActionHandlers();
    elements.downloadList.querySelectorAll('.download-item').forEach(item => {
        item.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const download = appState.downloads.get(item.dataset.downloadContextId);
            if (download && window.electronAPI.showDownloadContextMenu) {
                appState.downloadContextMenuTarget = { download, source: 'download' };
                window.electronAPI.showDownloadContextMenu({
                    id: download.id,
                    state: download.state,
                    paused: download.paused,
                    filePath: download.filePath,
                    source: 'download'
                });
            }
        });
    });
}

// 渲染媒体列表
async function loadMediaDownloadRecords() {
    if (!window.electronAPI.getAllMediaUrls) return [];
    const mediaList = await window.electronAPI.getAllMediaUrls();
    (mediaList || []).forEach(media => {
        if (media && media.download) {
            appState.mediaDownloads.set(media.url, media.download);
        }
    });
    return mediaList || [];
}

async function renderMediaList() {
    if (!elements.mediaList) return;
    let mediaList = [];
    try {
        mediaList = await loadMediaDownloadRecords();
    } catch (e) {
        console.error('获取全部媒体资源失败:', e);
    }
    if (!mediaList || mediaList.length === 0) {
        mediaList = Array.from(appState.mediaUrls.values()).flat();
    }
    // 按时间从新到旧排序
    mediaList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    
    // 分离已下载和未下载
    const undownloaded = mediaList.filter(media => {
        const dl = appState.mediaDownloads.get(media.url) || media.download;
        return !dl || dl.state !== 'completed';
    });
    const downloaded = mediaList.filter(media => {
        const dl = appState.mediaDownloads.get(media.url) || media.download;
        return dl && dl.state === 'completed';
    });
    
    if (undownloaded.length === 0 && downloaded.length === 0) {
        elements.mediaList.innerHTML = '<div class="empty-state">当前页面未检测到媒体资源</div>';
        return;
    }
    
    elements.mediaList.innerHTML = `
        <div class="media-toolbar">
            <button class="media-sniff-btn${appState.showCompletedOnly ? '' : ' active'}" onclick="toggleSniffView()">嗅探列表 (${undownloaded.length})</button>
            <button class="media-downloaded-btn${appState.showCompletedOnly ? ' active' : ''}" onclick="toggleCompletedView()" title="切换显示已下载列表">已经下载 (${downloaded.length})</button>
            <button class="media-clear-all" onclick="clearMediaList()">清除列表</button>
        </div>
        ${appState.showCompletedOnly ? '' : `
            <div class="media-batch-row">
                <button class="media-batch-download-btn" onclick="downloadAllMedia()">一键下载 (${undownloaded.length})</button>
            </div>
        `}
        ${renderMediaItems(
            appState.showCompletedOnly ? downloaded : undownloaded,
            appState.showCompletedOnly
        )}
    `;
    setupMediaActionHandlers();
    elements.mediaList.querySelectorAll('.media-item').forEach(item => {
        item.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            let url = item.dataset.mediaContextUrl || '';
            try {
                url = JSON.parse(url);
            } catch (e) {}
            const media = (appState.showCompletedOnly ? downloaded : undownloaded).find(entry => entry.url === url);
            const mediaDownload = media ? (appState.mediaDownloads.get(media.url) || media.download) : null;
            if (window.electronAPI.showDownloadContextMenu) {
                if (mediaDownload) {
                    appState.downloadContextMenuTarget = { download: mediaDownload, source: 'media' };
                    window.electronAPI.showDownloadContextMenu({
                        id: mediaDownload.id,
                        state: mediaDownload.state,
                        paused: mediaDownload.paused,
                        filePath: mediaDownload.filePath,
                        source: 'media'
                    });
                } else if (media) {
                    const virtualDownload = {
                        id: 'media-' + Date.now(),
                        state: 'not_started',
                        paused: false,
                        filePath: '',
                        url: media.url,
                        fileName: media.title || getFileNameFromUrl(media.url)
                    };
                    appState.downloadContextMenuTarget = { download: virtualDownload, source: 'media-undownloaded', mediaUrl: media.url, mediaTitle: media.title };
                    window.electronAPI.showDownloadContextMenu({
                        id: virtualDownload.id,
                        state: 'not_started',
                        paused: false,
                        filePath: '',
                        source: 'media-undownloaded'
                    });
                }
            }
        });
    });
}

// 渲染媒体项列表
function renderMediaItems(mediaList, isCompletedView) {
    if (mediaList.length === 0) {
        return `<div class="empty-state">${isCompletedView ? '暂无已下载的媒体文件' : '暂无未下载的媒体文件'}</div>`;
    }
    return mediaList.map((media) => {
        const fileName = getFileNameFromUrl(media.url);
        const displayName = media.title || fileName;
        const typeLabel = getMediaTypeLabel(media.type);
        const mediaDownload = appState.mediaDownloads.get(media.url) || media.download;
        const folderPath = mediaDownload && mediaDownload.filePath ? mediaDownload.filePath : '';
        const mediaProgress = mediaDownload && mediaDownload.totalBytes > 0 ? Math.round((mediaDownload.receivedBytes / mediaDownload.totalBytes) * 100) : 0;
        const mediaSizeText = mediaDownload ? `${formatBytes(mediaDownload.receivedBytes || 0)} / ${formatBytes(mediaDownload.totalBytes || 0)}` : '';
        const timeText = media.timestamp ? formatTime(media.timestamp) : '';
        return `
            <div class="media-item" data-media-context-url='${escapeHtml(JSON.stringify(media.url || ''))}'>
                <div class="media-icon">&#127916;</div>
                <div class="media-info">
                    <div class="media-type">${typeLabel}</div>
                    <div class="media-url">${escapeHtml(displayName)}</div>
                    <div class="media-meta">
                        <span class="media-time">${timeText}</span>
                        ${media.size ? `<span class="media-size-hint">${formatBytes(media.size)}</span>` : ''}
                    </div>
                    ${mediaDownload && !isCompletedView ? `
                        <div class="media-download-progress">
                            <div class="progress-bar"><div class="progress-fill" style="width: ${mediaProgress}%"></div></div>
                            <span class="download-size">${mediaSizeText}</span>
                        </div>
                        <div class="media-download-progress-label">${mediaDownload.state === 'completed' ? '下载完成' : mediaDownload.paused ? '已暂停' : '正在下载'}</div>
                    ` : ''}
                    ${isCompletedView && mediaDownload && mediaDownload.totalBytes > 0 ? `
                        <div class="media-download-progress-label" style="color:#52c41a">文件大小: ${formatBytes(mediaDownload.totalBytes)}</div>
                    ` : ''}
                </div>
                <div class="media-actions">
                    ${(!mediaDownload || !isCompletedView) ? `<button class="download-action-btn" data-action="download-media" data-media-url='${escapeHtml(JSON.stringify(media.url))}' data-media-name='${escapeHtml(JSON.stringify(displayName))}' title="下载">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    </button>` : ''}
                    ${mediaDownload && mediaDownload.state === 'completed' ? `
                        <button class="download-action-btn" data-action="folder-media-download" data-file-path='${escapeHtml(JSON.stringify(folderPath))}' title="打开文件所在文件夹">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                        </button>
                    ` : ''}
                    ${mediaDownload && mediaDownload.filePath ? `
                        <button class="download-action-btn danger" data-action="delete-media-download" data-download-id="${mediaDownload.id}" data-file-path='${escapeHtml(JSON.stringify(mediaDownload.filePath || ''))}' title="彻底删除本地文件">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// 切换显示已下载列表
function toggleSniffView() {
    appState.showCompletedOnly = false;
    renderMediaList();
}

function toggleCompletedView() {
    appState.showCompletedOnly = !appState.showCompletedOnly;
    renderMediaList();
}

// 更新收藏星号状态
function updateBookmarkStar(url) {
    if (!elements.bookmarkPageBtn) return;
    const isBookmarked = appState.bookmarks.some(b => b.url === url);
    if (isBookmarked) {
        elements.bookmarkPageBtn.classList.add('bookmarked');
        elements.bookmarkPageBtn.title = '取消收藏';
    } else {
        elements.bookmarkPageBtn.classList.remove('bookmarked');
        elements.bookmarkPageBtn.title = '添加书签';
    }
}

// 加载书签
async function loadBookmarks() {
    try {
        const bookmarks = await window.electronAPI.getBookmarks();
        appState.bookmarks = bookmarks;
        renderBookmarkBar(bookmarks);
        if (!elements.bookmarkList) return;
        if (bookmarks.length === 0) {
            elements.bookmarkList.innerHTML = '<div class="empty-state">暂无书签</div>';
            return;
        }
        elements.bookmarkList.innerHTML = bookmarks.map(bookmark => `
            <div class="bookmark-item" data-id="${bookmark.id}" data-url="${escapeHtml(bookmark.url)}" onclick="openBookmark('${escapeHtml(bookmark.url)}')">
                <div class="bookmark-icon">&#128204;</div>
                <div class="bookmark-info">
                    <div class="bookmark-title">${escapeHtml(bookmark.title)}</div>
                    <div class="bookmark-url">${escapeHtml(bookmark.url)}</div>
                </div>
                <button class="bookmark-delete" onclick="event.stopPropagation(); deleteBookmark('${bookmark.id}')">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
        `).join('');
        setupBookmarkListContextMenu();
    } catch (error) {
        console.error('加载书签失败:', error);
    }
}

function setupBookmarkListContextMenu() {
    if (!elements.bookmarkList) return;
    elements.bookmarkList.querySelectorAll('.bookmark-item').forEach(item => {
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.electronAPI.showBookmarkMenu) {
                window.electronAPI.showBookmarkMenu(item.dataset.id);
            }
        });
    });
}

// 渲染书签栏
function renderBookmarkBar(bookmarks) {
    if (!elements.bookmarkBarContent) return;
    if (bookmarks.length === 0) {
        elements.bookmarkBarContent.innerHTML = '<span class="bookmark-bar-empty">暂无书签</span>';
        if (elements.bookmarkOverflowBtn) elements.bookmarkOverflowBtn.style.display = 'none';
        return;
    }
    elements.bookmarkBarContent.innerHTML = bookmarks.map((bookmark, index) => `
        <div class="bookmark-bar-item" 
             data-url="${escapeHtml(bookmark.url)}" 
             data-id="${bookmark.id}"
             data-index="${index}"
             draggable="true"
             title="${escapeHtml(bookmark.title)}">
            <span>${escapeHtml(bookmark.title)}</span>
        </div>
    `).join('');

    elements.bookmarkBarContent.querySelectorAll('.bookmark-bar-item').forEach(item => {
        item.addEventListener('click', () => {
            const url = item.dataset.url;
            if (url) createTab(url);
        });
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.electronAPI.showBookmarkMenu) {
                window.electronAPI.showBookmarkMenu(item.dataset.id);
            }
        });
    });
    
    // 检测溢出
    setTimeout(() => {
        checkBookmarkOverflow(bookmarks);
    }, 150);
}

// 检测溢出
function checkBookmarkOverflow(bookmarks) {
    if (!elements.bookmarkOverflowBtn || !elements.bookmarkBarContent) return;
    
    const bar = elements.bookmarkBarContent.parentElement;
    if (!bar) return;
    
    // 书签栏可用宽度 = 总宽度 - 溢出按钮(24px) - 间距(4px)
    let availableWidth = bar.clientWidth - 28;
    if (availableWidth < 0) availableWidth = 0;
    
    const items = elements.bookmarkBarContent.querySelectorAll('.bookmark-bar-item');
    const overflowIndices = [];
    const barContentRect = elements.bookmarkBarContent.getBoundingClientRect();
    
    for (let i = 0; i < items.length; i++) {
        const rect = items[i].getBoundingClientRect();
        const itemRight = rect.right - barContentRect.left;
        if (itemRight > availableWidth) {
            overflowIndices.push(i);
        }
    }
    
    if (overflowIndices.length > 0) {
        elements.bookmarkOverflowBtn.style.display = 'flex';
        appState.overflowBookmarkIds = overflowIndices.map(i => bookmarks[i]).filter(Boolean).map(b => b.id);
    } else {
        elements.bookmarkOverflowBtn.style.display = 'none';
        appState.overflowBookmarkIds = [];
    }
}

// 溢出按钮点击 — 使用原生Menu避免被BrowserView遮挡
function setupBookmarkOverflow() {
    if (!elements.bookmarkOverflowBtn) return;
    
    elements.bookmarkOverflowBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!appState.overflowBookmarkIds || appState.overflowBookmarkIds.length === 0) return;
        if (window.electronAPI.showBookmarkOverflowMenu) {
            const rect = elements.bookmarkOverflowBtn.getBoundingClientRect();
            await window.electronAPI.showBookmarkOverflowMenu(appState.overflowBookmarkIds, { x: rect.left, y: rect.bottom, width: rect.width, height: rect.height });
        }
    });
    
    // 窗口大小变化
    window.addEventListener('resize', () => {
        if (appState.bookmarks.length > 0) {
            checkBookmarkOverflow(appState.bookmarks);
        }
    });
}

// 拖拽排序
function handleDragStart(e) {
    appState.dragSrcEl = this;
    appState.dragSrcIndex = parseInt(this.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.style.opacity = '0.5';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

async function handleDrop(e) {
    e.stopPropagation();
    e.preventDefault();
    if (appState.dragSrcEl !== this) {
        const targetIndex = parseInt(this.dataset.index);
        const srcIndex = appState.dragSrcIndex;
        const bookmarks = [...appState.bookmarks];
        const [moved] = bookmarks.splice(srcIndex, 1);
        bookmarks.splice(targetIndex, 0, moved);
        appState.bookmarks = bookmarks;
        renderBookmarkBar(bookmarks);
        if (window.electronAPI.updateBookmarkOrder) {
            await window.electronAPI.updateBookmarkOrder(bookmarks);
        }
    }
    return false;
}

function handleDragEnd(e) {
    this.style.opacity = '1';
    appState.dragSrcEl = null;
    appState.dragSrcIndex = null;
}

// 加载历史记录
async function loadHistory() {
    try {
        const history = await window.electronAPI.getHistory();
        if (!elements.historyList) return;
        const toolbarHtml = `
            <div class="history-toolbar">
                <button class="history-clear-records" onclick="clearHistory()">一键清除</button>
            </div>
        `;
        if (history.length === 0) {
            elements.historyList.innerHTML = `${toolbarHtml}<div class="empty-state">暂无历史记录</div>`;
            return;
        }
        elements.historyList.innerHTML = toolbarHtml + history.map(item => `
            <div class="history-item" onclick="openHistory('${escapeHtml(item.url)}')">
                <div class="history-icon">&#128336;</div>
                <div class="history-info">
                    <div class="history-title">${escapeHtml(item.title)}</div>
                    <div class="history-url">${escapeHtml(item.url)}</div>
                </div>
                <div class="history-time">${formatTime(item.timestamp)}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('加载历史记录失败:', error);
    }
}

// 加载设置
async function loadSettings() {
    try {
        const settings = await window.electronAPI.getSettings();
        appState.settings = settings;
        if (elements.homepageInput) elements.homepageInput.value = settings.homepage || '';
        if (elements.searchEngineSelect) elements.searchEngineSelect.value = settings.searchEngine || 'baidu';
        if (elements.downloadPathInput) elements.downloadPathInput.value = settings.downloadPath || '';
        if (elements.fontSizeRange) elements.fontSizeRange.value = settings.fontSize || 16;
        if (elements.fontSizeValue) elements.fontSizeValue.textContent = settings.fontSize || 16;
        applyFontSize(settings.fontSize || 16);
        if (elements.adblockCheckbox) elements.adblockCheckbox.checked = settings.adblockEnabled !== false;
        if (elements.darkModeCheckbox) elements.darkModeCheckbox.checked = settings.darkMode || false;
        if (elements.autoTranslateCheckbox) elements.autoTranslateCheckbox.checked = settings.autoTranslate !== false;
        if (elements.alwaysTranslateNonCjkCheckbox) elements.alwaysTranslateNonCjkCheckbox.checked = settings.alwaysTranslateNonCjk !== false;
        if (settings.darkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        // 初始化时通知主进程向网页注入深色模式CSS
        if (window.electronAPI.setDarkModeForPages) {
            window.electronAPI.setDarkModeForPages(settings.darkMode || false);
        }
        const version = await window.electronAPI.getAppVersion();
        if (elements.appVersion) elements.appVersion.textContent = version;
        const versions = await window.electronAPI.getVersions();
        if (versions) {
            if (elements.electronVersion) elements.electronVersion.textContent = versions.electron || '--';
            if (elements.chromiumVersion) elements.chromiumVersion.textContent = versions.chrome || '--';
        }
        // 加载已标记广告规则
        await loadCustomAdRules();
    } catch (error) {
        console.error('加载设置失败:', error);
    }
}

// 加载已标记广告规则列表
async function loadCustomAdRules() {
    if (!elements.customAdRulesList) return;
    try {
        const rules = await window.electronAPI.getCustomAdRules();
        if (!rules || rules.length === 0) {
            elements.customAdRulesList.innerHTML = '<div class="empty-state" style="padding: 10px; color: #888; font-size: 13px;">暂无已标记的广告元素</div>';
            return;
        }
        // 按时间从新到旧排序（createdAt 大的在前）
        const sortedRules = [...rules].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        let html = '';
        sortedRules.forEach((rule, displayIndex) => {
            // 找到原始数组中的真实索引
            const originalIndex = rules.indexOf(rule);
            const selector = rule.selector || '';
            const domain = rule.domain || '*';
            const shortSelector = selector.length > 50 ? selector.substring(0, 50) + '...' : selector;
            const timeStr = rule.createdAt ? new Date(rule.createdAt).toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
            html += '<div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 12px;">';
            html += '<div style="flex: 1; overflow: hidden;">';
            html += '<div style="font-weight: 600; color: #333;">' + domain + ' <span style="color: #bbb; font-weight: normal; font-size: 11px;">' + timeStr + '</span></div>';
            html += '<div style="color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="' + selector.replace(/"/g, '&quot;') + '">' + shortSelector + '</div>';
            html += '</div>';
            html += '<button data-rule-index="' + originalIndex + '" class="delete-rule-btn" style="background: #ff4d4f; color: white; border: none; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 11px; margin-left: 8px; flex-shrink: 0;">删除</button>';
            html += '</div>';
        });
        elements.customAdRulesList.innerHTML = html;
        // 绑定删除按钮事件
        elements.customAdRulesList.querySelectorAll('.delete-rule-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const idx = parseInt(btn.dataset.ruleIndex);
                await window.electronAPI.deleteCustomAdRule(idx);
                await loadCustomAdRules();
            });
        });
    } catch (error) {
        console.error('加载广告规则失败:', error);
    }
}

// 更新设置
async function updateSettings() {
    try {
        const newSettings = {
            homepage: elements.homepageInput ? elements.homepageInput.value : '',
            searchEngine: elements.searchEngineSelect ? elements.searchEngineSelect.value : 'baidu',
            fontSize: elements.fontSizeRange ? Number(elements.fontSizeRange.value) : 16,
            adblockEnabled: elements.adblockCheckbox ? elements.adblockCheckbox.checked : true,
            darkMode: elements.darkModeCheckbox ? elements.darkModeCheckbox.checked : false,
            autoTranslate: elements.autoTranslateCheckbox ? elements.autoTranslateCheckbox.checked : true,
            alwaysTranslateNonCjk: elements.alwaysTranslateNonCjkCheckbox ? elements.alwaysTranslateNonCjkCheckbox.checked : true
        };
        await window.electronAPI.updateSettings(newSettings);
        Object.assign(appState.settings, newSettings);
        if (newSettings.darkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        // 通知主进程向网页注入/移除深色模式CSS
        if (window.electronAPI.setDarkModeForPages) {
            window.electronAPI.setDarkModeForPages(newSettings.darkMode);
        }
    } catch (error) {
        console.error('更新设置失败:', error);
    }
}

function applyFontSize(value) {
    const size = Math.max(8, Math.min(28, Number(value) || 16));
    if (elements.fontSizeValue) elements.fontSizeValue.textContent = size;
    document.documentElement.style.setProperty('--app-font-size', `${size}px`);
}

// 更新下载徽章
function updateDownloadBadge() {
    if (!elements.downloadBadge) return;
    const activeDownloads = Array.from(appState.downloads.values()).filter(d => d.state === 'progressing' && !isMediaDownloadRecord(d)).length;
    elements.downloadBadge.textContent = activeDownloads;
    elements.downloadBadge.classList.toggle('hidden', activeDownloads === 0);
}

// 更新媒体徽章
function updateMediaBadge() {
    if (!elements.mediaBadge) return;
    const seen = new Set();
    appState.mediaUrls.forEach(list => {
        (list || []).forEach(media => {
            if (media && media.url) {
                // 只计算未下载的媒体
                const dl = appState.mediaDownloads.get(media.url) || media.download;
                if (!dl || dl.state !== 'completed') {
                    seen.add(media.url);
                }
            }
        });
    });
    const mediaCount = seen.size;
    elements.mediaBadge.textContent = mediaCount;
    elements.mediaBadge.classList.toggle('hidden', mediaCount === 0);
}

// 下载项操作按钮
function setupDownloadActionHandlers() {
    if (!elements.downloadList) return;
    elements.downloadList.querySelectorAll('.download-action-btn').forEach(btn => {
        btn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const action = btn.dataset.action;
            const downloadId = btn.dataset.downloadId;
            if (action === 'pause') {
                await pauseDownload(downloadId);
                return;
            }
            if (action === 'resume') {
                await resumeDownload(downloadId);
                return;
            }
            let filePath = btn.dataset.filePath || '';
            try {
                filePath = JSON.parse(filePath);
            } catch (e) {}
            if (!filePath) {
                alert('文件路径为空，无法操作');
                return;
            }
            if (action === 'folder') {
                await showInFolder(filePath);
            } else if (action === 'delete') {
                await deleteDownload(downloadId, filePath);
            }
        });
    });
}

function setupMediaActionHandlers() {
    if (!elements.mediaList) return;
    elements.mediaList.querySelectorAll('[data-action="download-media"]').forEach(btn => {
        btn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            let mediaUrl = btn.dataset.mediaUrl || '';
            let mediaName = btn.dataset.mediaName || '';
            try { mediaUrl = JSON.parse(mediaUrl); } catch (e) {}
            try { mediaName = JSON.parse(mediaName); } catch (e) {}
            await downloadMedia(mediaUrl, mediaName);
        });
    });
    elements.mediaList.querySelectorAll('[data-action="delete-media-download"]').forEach(btn => {
        btn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            let filePath = btn.dataset.filePath || '';
            let mediaUrl = btn.dataset.mediaUrl || '';
            try {
                filePath = JSON.parse(filePath);
            } catch (e) {}
            try {
                mediaUrl = JSON.parse(mediaUrl);
            } catch (e) {}
            await deleteDownload(btn.dataset.downloadId, filePath);
            appState.mediaDownloads.forEach((download, url) => {
                if (download.id === btn.dataset.downloadId) appState.mediaDownloads.delete(url);
            });
            renderMediaList();
        });
    });
    elements.mediaList.querySelectorAll('[data-action="folder-media-download"]').forEach(btn => {
        btn.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            let filePath = btn.dataset.filePath || '';
            try {
                filePath = JSON.parse(filePath);
            } catch (e) {}
            await showInFolder(filePath);
        });
    });
}

// 地址栏右键菜单
function showAddressBarContextMenu(x, y) {
    console.log('[APP] 显示地址栏右键菜单', x, y);
    // 移除已存在的菜单
    const existingMenu = document.getElementById('address-bar-context-menu');
    if (existingMenu) existingMenu.remove();
    
    const menu = document.createElement('div');
    menu.id = 'address-bar-context-menu';
    menu.className = 'context-menu show';
    menu.style.position = 'fixed';
    menu.style.zIndex = '99999';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy">复制</div>
        <div class="context-menu-item" data-action="paste">粘贴</div>
        <div class="context-menu-item" data-action="cut">剪切</div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" data-action="select-all">全选</div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item danger" data-action="delete">删除</div>
    `;
    
    // 定位菜单在鼠标位置
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    document.body.appendChild(menu);
    console.log('[APP] 地址栏右键菜单已添加到DOM');
    
    // 点击菜单项
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            console.log('[APP] 地址栏右键菜单点击', action);
            if (action === 'copy') {
                document.execCommand('copy');
            } else if (action === 'paste') {
                document.execCommand('paste');
            } else if (action === 'cut') {
                document.execCommand('cut');
            } else if (action === 'select-all') {
                elements.addressInput.select();
            } else if (action === 'delete') {
                elements.addressInput.value = '';
                elements.addressInput.focus();
            }
            menu.remove();
        });
    });
    
    // 点击其他地方关闭菜单
    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
            document.removeEventListener('scroll', closeMenu);
        }
    };
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
        document.addEventListener('scroll', closeMenu);
    }, 10);
}

// 在文件夹中显示
async function showInFolder(filePath) {
    const result = await window.electronAPI.showDownloadInFolder(filePath);
    if (!result || !result.success) {
        alert(`打开文件所在文件夹失败：${result && result.error ? result.error : '未知错误'}`);
    }
}

async function deleteDownload(downloadId, filePath) {
    if (!confirm('是否删除本地文件！')) return;
    const result = await window.electronAPI.deleteDownload(downloadId, filePath);
    if (result && result.success) {
        appState.downloads.delete(downloadId);
        updateDownloadBadge();
        renderDownloadList();
    } else {
        alert(`删除失败：${result && result.error ? result.error : '未知错误'}`);
    }
}

async function removeDownloadRecord(downloadId) {
    const result = await window.electronAPI.removeDownloadRecord(downloadId);
    if (result && result.success) {
        appState.downloads.delete(downloadId);
        appState.mediaDownloads.forEach((download, url) => {
            if (download.id === downloadId) appState.mediaDownloads.delete(url);
        });
        updateDownloadBadge();
    } else {
        alert(`移除记录失败：${result && result.error ? result.error : '未知错误'}`);
    }
}

async function clearDownloadRecords() {
    const result = await window.electronAPI.clearDownloadRecords();
    if (result && result.success) {
        appState.downloads.forEach((download, id) => {
            if (download.state !== 'progressing') appState.downloads.delete(id);
        });
        updateDownloadBadge();
        renderDownloadList();
    } else {
        alert(`清除下载记录失败：${result && result.error ? result.error : '未知错误'}`);
    }
}

// 下载媒体
async function downloadMedia(url, fileName) {
    try {
        const result = await window.electronAPI.downloadMedia(url, fileName, { roughName: appState.mediaRoughNaming });
        if (result.success) {
            console.log('媒体下载已开始:', url);
        } else {
            alert(`媒体下载失败：${result.error}`);
        }
    } catch (error) {
        console.error('下载媒体失败:', error);
    }
}

async function downloadAllMedia() {
    try {
        const mediaList = window.electronAPI.getAllMediaUrls ? await window.electronAPI.getAllMediaUrls() : Array.from(appState.mediaUrls.values()).flat();
        if (!mediaList || mediaList.length === 0) {
            alert('当前没有可下载的嗅探视频');
            return;
        }
        // 只下载未完成的
        const undownloaded = mediaList.filter(media => {
            const dl = appState.mediaDownloads.get(media.url) || media.download;
            return !dl || dl.state !== 'completed';
        });
        if (undownloaded.length === 0) {
            alert('所有视频都已下载');
            return;
        }
        const result = await window.electronAPI.downloadMediaList(undownloaded, { roughName: appState.mediaRoughNaming });
        if (!result || !result.success) {
            alert(`一键下载失败：${result && result.error ? result.error : '未知错误'}`);
        }
    } catch (error) {
        alert(`一键下载失败：${error.message}`);
    }
}

function toggleMediaRoughNaming(checked) {
    appState.mediaRoughNaming = Boolean(checked);
    if (checked) {
        startAutoSniff();
    } else {
        stopAutoSniff();
    }
}

// 一键暂停/继续所有下载
async function toggleDownloadPause() {
    const btn = document.getElementById('pauseDownloadBtn');
    if (!btn) return;

    try {
        const state = await window.electronAPI.getAllDownloadPauseState();
        if (state.total === 0) {
            alert('当前没有进行中的下载任务');
            return;
        }
        if (state.pausedCount === state.total) {
            // 全部已暂停 → 全部继续
            await window.electronAPI.resumeAllDownloads();
            btn.textContent = '暂停下载';
            btn.classList.remove('paused');
        } else {
            // 有正在下载的 → 全部暂停
            await window.electronAPI.pauseAllDownloads();
            btn.textContent = '继续下载';
            btn.classList.add('paused');
        }
    } catch (e) {
        console.error('切换下载暂停状态失败:', e);
    }
}

// ==================== 自动嗅探功能 ====================

// DOM 元素引用（初始化时填充）
let sniffOverlay = null;
let sniffCrosshair = null;
let sniffStatus = null;
let sniffStatusCount = null;
let sniffPageConfirm = null;
let sniffPageMark = null;

// 初始化自动嗅探 DOM 引用
function initAutoSniffDOM() {
    sniffOverlay = document.getElementById('autoSniffOverlay');
    sniffCrosshair = document.getElementById('sniffCrosshair');
    sniffStatus = document.getElementById('sniffStatus');
    sniffStatusCount = document.getElementById('sniffCount');
    sniffPageConfirm = document.getElementById('sniffPageConfirm');
    sniffPageMark = document.getElementById('sniffPageMark');

    // 翻页确认按钮
    const sniffPageYes = document.getElementById('sniffPageYes');
    const sniffPageNo = document.getElementById('sniffPageNo');
    if (sniffPageYes) sniffPageYes.addEventListener('click', onSniffPageYes);
    if (sniffPageNo) sniffPageNo.addEventListener('click', onSniffPageNo);

    // 覆盖层鼠标移动 - 显示十字准星
    if (sniffOverlay) {
        sniffOverlay.addEventListener('mousemove', onSniffMouseMove);
        sniffOverlay.addEventListener('click', onSniffOverlayClick);
        sniffOverlay.addEventListener('contextmenu', (e) => { e.preventDefault(); stopAutoSniff(); });
    }

    // ESC 键退出
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && appState.autoSniffActive) {
            stopAutoSniff();
        }
    });
}

// 启动自动嗅探
function startAutoSniff() {
    if (appState.autoSniffActive) return;
    appState.autoSniffActive = true;
    appState.autoSniffMode = 'marking';  // 等待标记嗅探起始位置
    appState.autoSniffStartPos = null;
    // 不重置翻页坐标，因为用户可能已经在第一轮标记过了

    // 显示覆盖层和十字准星
    if (sniffOverlay) {
        sniffOverlay.classList.remove('hidden');
        sniffOverlay.classList.add('active');
    }
    if (sniffCrosshair) sniffCrosshair.classList.remove('hidden');
    if (sniffStatus) sniffStatus.classList.add('hidden');
    if (sniffPageConfirm) sniffPageConfirm.classList.add('hidden');
    if (sniffPageMark) sniffPageMark.classList.add('hidden');

    console.log('[AUTO_SNIFF] 启动，等待标记嗅探起始位置');
}

// 停止自动嗅探
function stopAutoSniff() {
    if (!appState.autoSniffActive) return;
    appState.autoSniffActive = false;
    appState.autoSniffMode = 'idle';
    if (appState.autoSniffScrollTimer) {
        clearInterval(appState.autoSniffScrollTimer);
        appState.autoSniffScrollTimer = null;
    }

    // 隐藏覆盖层
    if (sniffOverlay) {
        sniffOverlay.classList.add('hidden');
        sniffOverlay.classList.remove('active');
    }
    if (sniffCrosshair) sniffCrosshair.classList.add('hidden');
    if (sniffStatus) sniffStatus.classList.add('hidden');
    if (sniffPageConfirm) sniffPageConfirm.classList.add('hidden');
    if (sniffPageMark) sniffPageMark.classList.add('hidden');

    // 隐藏暂停按钮
    const pauseBtn = document.getElementById('sniffPauseBtn');
    if (pauseBtn) pauseBtn.style.display = 'none';

    console.log('[AUTO_SNIFF] 已停止');
}

// 鼠标移动 - 更新十字准星位置
function onSniffMouseMove(e) {
    if (appState.autoSniffMode === 'marking' || appState.autoSniffMode === 'marking-page') {
        if (sniffCrosshair) {
            sniffCrosshair.style.left = e.clientX + 'px';
            sniffCrosshair.style.top = e.clientY + 'px';
        }
    }
}

// 覆盖层点击 - 根据模式处理
async function onSniffOverlayClick(e) {
    if (!appState.autoSniffActive) return;

    if (appState.autoSniffMode === 'marking') {
        // 标记嗅探起始位置
        appState.autoSniffStartPos = { x: e.clientX, y: e.clientY };
        appState.autoSniffMode = 'scrolling';
        console.log('[AUTO_SNIFF] 标记嗅探起始位置:', appState.autoSniffStartPos);

        // 开始自动滚动嗅探
        await startAutoSniffScroll();
    } else if (appState.autoSniffMode === 'marking-page') {
        // 标记翻页按钮位置
        appState.autoSniffPagePos = { x: e.clientX, y: e.clientY };
        appState.autoSniffMode = 'auto-scrolling';
        if (sniffPageMark) sniffPageMark.classList.add('hidden');
        console.log('[AUTO_SNIFF] 标记翻页按钮位置:', appState.autoSniffPagePos);

        // 开始自动翻页和滚动
        await startAutoSniffScroll();
    } else if (appState.autoSniffMode === 'scrolling' || appState.autoSniffMode === 'auto-scrolling') {
        // 自动嗅探过程中点击鼠标 → 停止
        stopAutoSniff();
    }
}

// 点击"是" - 开始标记翻页按钮
function onSniffPageYes() {
    appState.autoSniffMode = 'marking-page';
    if (sniffPageConfirm) sniffPageConfirm.classList.add('hidden');
    if (sniffPageMark) {
        sniffPageMark.classList.remove('hidden');
    }
    console.log('[AUTO_SNIFF] 进入翻页坐标标记模式');
}

// 点击"否" - 停止自动嗅探
function onSniffPageNo() {
    stopAutoSniff();
}

// 开始自动滚动嗅探
async function startAutoSniffScroll() {
    if (!appState.activeTabId) return;
    const tab = appState.tabs.get(appState.activeTabId);
    if (!tab || !tab.webContentsId) return;

    appState.autoSniffLastSniffCount = 0;

    // 显示状态提示
    if (sniffStatus) sniffStatus.classList.remove('hidden');
    updateSniffCount();

    // 通过 IPC 让主进程执行滚动
    if (window.electronAPI.startAutoSniffScroll) {
        window.electronAPI.startAutoSniffScroll(tab.webContentsId, {
            startPos: appState.autoSniffStartPos,
            pagePos: appState.autoSniffPagePos
        });
    }
}

// 更新嗅探计数显示
function updateSniffCount() {
    let count = 0;
    appState.mediaUrls.forEach(list => {
        (list || []).forEach(media => {
            if (media && media.url) count++;
        });
    });
    if (sniffStatusCount) sniffStatusCount.textContent = count;
    appState.autoSniffLastSniffCount = count;
}

// 接收主进程通知：滚动完成（到底了）
function onAutoSniffScrollBottom() {
    if (appState.autoSniffMode !== 'scrolling' && appState.autoSniffMode !== 'auto-scrolling') return;
    console.log('[AUTO_SNIFF] 检测到页面底部');

    // 停止滚动定时器
    if (appState.autoSniffScrollTimer) {
        clearInterval(appState.autoSniffScrollTimer);
        appState.autoSniffScrollTimer = null;
    }

    // 显示翻页确认弹窗
    if (sniffStatus) sniffStatus.classList.add('hidden');
    if (sniffPageConfirm) sniffPageConfirm.classList.remove('hidden');
}

// 接收主进程通知：翻页成功（继续滚动）
function onAutoSniffPageNext() {
    if (appState.autoSniffMode !== 'auto-scrolling') return;
    console.log('[AUTO_SNIFF] 自动翻页成功，继续滚动');
    updateSniffCount();
    // 继续自动滚动已在 startAutoSniffScroll 中处理
}

// 接收主进程通知：更新嗅探计数
function onAutoSniffCountUpdate(count) {
    if (sniffStatusCount) sniffStatusCount.textContent = count;
    appState.autoSniffLastSniffCount = count;
}

async function deleteMediaUrl(tabId, url) {
    const result = await window.electronAPI.deleteMediaUrl(tabId, url);
    if (result && result.success) {
        if (tabId && appState.mediaUrls.has(tabId)) {
            appState.mediaUrls.set(tabId, (appState.mediaUrls.get(tabId) || []).filter(media => media.url !== url));
        } else {
            appState.mediaUrls.forEach((list, key) => {
                appState.mediaUrls.set(key, (list || []).filter(media => media.url !== url));
            });
        }
        updateMediaBadge();
        renderMediaList();
    } else {
        alert(`删除嗅探记录失败：${result && result.error ? result.error : '未知错误'}`);
    }
}

async function clearMediaList() {
    if (appState.showCompletedOnly) {
        // 清除已下载列表
        appState.mediaDownloads.forEach((download, url) => {
            if (download.state === 'completed') appState.mediaDownloads.delete(url);
        });
        updateMediaBadge();
        renderMediaList();
        return;
    }
    // 清除嗅探列表（仅清除未下载的嗅探记录，不影响已下载的）
    const result = await window.electronAPI.clearMediaList();
    if (result && result.success) {
        appState.mediaUrls.clear();
        appState.mediaDownloads.forEach((download, url) => {
            if (download.state !== 'completed' && download.state !== 'progressing') appState.mediaDownloads.delete(url);
        });
        updateMediaBadge();
        renderMediaList();
    } else {
        alert(`清除嗅探列表失败：${result && result.error ? result.error : '未知错误'}`);
    }
}

async function pauseDownload(downloadId) {
    const result = await window.electronAPI.pauseDownload(downloadId);
    if (!result || !result.success) {
        alert(`暂停失败：${result && result.error ? result.error : '未知错误'}`);
    }
}

async function resumeDownload(downloadId) {
    const result = await window.electronAPI.resumeDownload(downloadId);
    if (!result || !result.success) {
        alert(`继续失败：${result && result.error ? result.error : '未知错误'}`);
    }
}

// 打开书签
function openBookmark(url) {
    createTab(url);
}

// 删除书签
async function deleteBookmark(bookmarkId) {
    try {
        await window.electronAPI.removeBookmark(bookmarkId);
        await loadBookmarks();
    } catch (error) {
        console.error('删除书签失败:', error);
    }
}

// 打开历史记录
function openHistory(url) {
    createTab(url);
}

// 一键清除历史记录
async function clearHistory() {
    if (!confirm('是否清除全部历史记录？')) return;
    try {
        await window.electronAPI.clearHistory();
        await loadHistory();
    } catch (error) {
        console.error('清除历史记录失败:', error);
        alert(`清除历史记录失败：${error && error.message ? error.message : '未知错误'}`);
    }
}

// 工具函数
function isMediaDownloadRecord(download) {
    return Boolean(download && (
        download.category === 'media' ||
        download.mediaUrl ||
        download.mediaTitle
    ));
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function getFileNameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const fileName = urlObj.pathname.split('/').pop();
        return fileName || '未知文件';
    } catch {
        return '未知文件';
    }
}

function getMediaTypeLabel(type) {
    const labels = {
        'video/mp4': 'MP4 视频', 'video/webm': 'WebM 视频',
        'application/x-mpegURL': 'M3U8 流媒体', 'audio/mp3': 'MP3 音频',
        'audio/wav': 'WAV 音频', 'video/mp2t': 'TS 视频', 'video/unknown': '未知视频'
    };
    return labels[type] || type;
}

// 日志功能
async function loadLogs() {
    try {
        if (!elements.logContent) return;
        const logs = await window.electronAPI.getLogs();
        if (!logs || logs.trim() === '') {
            elements.logContent.innerHTML = '<div class="empty-state">暂无日志</div>';
            return;
        }
        const lines = logs.split('\n');
        const coloredLines = lines.map(line => {
            let cssClass = 'log-line';
            if (line.includes('[ERROR]')) cssClass += ' log-error';
            else if (line.includes('[WARN]')) cssClass += ' log-warn';
            else if (line.includes('[ADBLOCK]')) cssClass += ' log-adblock';
            else if (line.includes('[MEDIA]')) cssClass += ' log-media';
            else if (line.includes('[DOWNLOAD]')) cssClass += ' log-download';
            else if (line.includes('[TRANSLATE]')) cssClass += ' log-translate';
            else if (line.includes('[TAB]')) cssClass += ' log-tab';
            else if (line.includes('[NAVIGATE]')) cssClass += ' log-navigate';
            else if (line.includes('[BOOKMARK]')) cssClass += ' log-bookmark';
            else if (line.includes('[HISTORY]')) cssClass += ' log-history';
            else if (line.includes('[SETTINGS]')) cssClass += ' log-settings';
            else if (line.includes('[INFO]')) cssClass += ' log-info';
            return `<div class="${cssClass}">${escapeHtml(line)}</div>`;
        }).join('');
        elements.logContent.innerHTML = coloredLines;
        elements.logContent.scrollTop = elements.logContent.scrollHeight;
    } catch (error) {
        if (elements.logContent) {
            elements.logContent.innerHTML = `<div class="log-line log-error">加载日志失败: ${escapeHtml(error.message)}</div>`;
        }
    }
}

async function copyLogs() {
    try {
        const logs = await window.electronAPI.getLogs();
        await navigator.clipboard.writeText(logs);
        // 不弹窗，改用按钮文字反馈
        var btn = document.getElementById('copyLogBtn');
        if (btn) {
            var origText = btn.textContent;
            btn.textContent = '已复制';
            setTimeout(function() { btn.textContent = origText; }, 1500);
        }
    } catch (error) {
        alert('复制失败: ' + error.message);
    }
}

async function clearLogs() {
    try {
        await window.electronAPI.clearLogs();
        if (elements.logContent) elements.logContent.innerHTML = '<div class="empty-state">日志已清空</div>';
    } catch (error) {
        alert('清空失败: ' + error.message);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 启动应用
document.addEventListener('DOMContentLoaded', init);
