/* ============================================================
   游戏引擎 —— 嵌入模式支持
   ★ 默认不显示启动框；只有 showLoader: true 时才显示
   ★ 接收剧情包注入的 items 物品表
   ============================================================ */
(function () {
    if (!window.parent || window.parent === window) return;

    console.log('[embed] 游戏引擎运行在 iframe 中');

    const loader = document.getElementById('loader');
    if (loader) loader.classList.add('hide');

    function showWaiting(text) {
        if (!loader) return;
        loader.classList.remove('hide');
        const box = loader.querySelector('.loader-box');
        if (box) {
            box.innerHTML = `
                <div class="loader-title">剧情编辑器</div>
                <div class="loader-sub">等待房间数据</div>
                <div style="margin-top:24px;color:#6a7a86;font-size:12px;
                    font-family:ui-monospace,monospace;line-height:1.8;">
                    ${text || '从「测试游戏」标签页载入房间'}
                </div>
            `;
        }
    }

    function showLoading(text) {
        if (!loader) return;
        loader.classList.remove('hide');
        const box = loader.querySelector('.loader-box');
        if (box) {
            box.innerHTML = `
                <div class="loader-title">剧情编辑器</div>
                <div class="loader-sub">${text || '加载中…'}</div>
            `;
        }
    }

    function hideLoader() {
        if (loader) loader.classList.add('hide');
    }

    function blackout() {
        const cv = document.getElementById('game-canvas');
        if (!cv) return;
        try {
            const g = cv.getContext('2d');
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.fillStyle = '#000';
            g.fillRect(0, 0, cv.width, cv.height);
        } catch (e) { }
    }

    blackout();

    Bridge.send('embed-ready', { role: 'game' });

    Bridge.on('load-room-zip', async (msg) => {
        const showLoader = !!(msg && msg.showLoader === true);

        try {
            if (!msg || !msg.zipBuffer) {
                Bridge.send('game-loaded', { ok: false, error: '缺少 zipBuffer' });
                if (showLoader) showWaiting('载入失败：缺少数据');
                return;
            }
            const engine = window.__engine;
            if (!engine) {
                Bridge.send('game-loaded', { ok: false, error: '引擎未初始化' });
                if (showLoader) showWaiting('载入失败：引擎未就绪');
                return;
            }

            blackout();
            if (showLoader) showLoading('准备加载…');

            /* 彻底停掉一切 */
            engine.running = false;
            if (typeof RoomUI !== 'undefined') {
                RoomUI._running = false;
                RoomUI.clear();
                /* ★ 先注入物品表 */
                if (msg.items) {
                    RoomUI.setItems(msg.items);
                }
            }
            engine.elements.clear();
            engine.actors = [];
            engine.player = null;
            engine.events = {};
            engine.characterScripts = {};
            engine.roomScript = null;
            engine._firedEvents = new Set();
            engine._actorObstacleCache = new Map();
            if (typeof UI !== 'undefined') {
                UI.setInteractTarget(null);
                UI.fadeAlpha = 1;
                UI.fadeTarget = 1;
                UI.fadeSpeed = 1;
            }

            await new Promise(r => setTimeout(r, 200));

            if (showLoader) showLoading('解析房间包…');
            await engine.loadRoomFromZip(msg.zipBuffer);

            if (showLoader) showLoading('启动…');
            hideLoader();

            await engine.start();

            Bridge.send('game-loaded', { ok: true });
        } catch (e) {
            console.error('[embed] 加载房间失败', e);
            Bridge.send('game-loaded', { ok: false, error: e.message });
            if (showLoader) showWaiting('载入失败：' + e.message);
        }
    });

    Bridge.on('game-stop', () => {
        const engine = window.__engine;
        if (engine) engine.running = false;
        if (typeof RoomUI !== 'undefined') RoomUI._running = false;
        blackout();
        if (loader) loader.classList.add('hide');
        Bridge.send('game-stopped', { ok: true });
    });
})();