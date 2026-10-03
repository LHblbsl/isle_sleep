/* ============================================================
   剧情播放器（预渲染下一帧 + 揭开/渐隐/自定义转场 + 多路BGM）
   ============================================================ */

var Player = {
    running: false,
    scene: null,
    itemIdx: 0,
    _skipRequested: false,
    _finishHook: null,
    _jumpRequest: null,
    _scriptCache: new Map(),
    _lastErr: null,

    _bgmAudios: new Map(),
    _sfxList: [], _curStageAudio: null,

    _stageRT: null,
    _stageScale: 1,
    _stageOX: 0,
    _stageOY: 0,
    _stageImgCache: new Map(),
    _stageVideoCache: new Map(),
    _stageEffectCanvas: new Map(),

    _htmlFrames: new Map(),
    _measureCtx: null,

    _lastFrame: null,
    _pendingOverlay: null,

    // ★ 当前 stage 上下文（prevFrame / nextFrame 通过这个暴露给脚本）
    _currentStageCtx: null,

    stopBgmOnStageEnd: false,

    init() {
        const skipBtn = document.getElementById('player-skip-btn');
        const stopBtn = document.getElementById('player-stop-btn');
        if (skipBtn) skipBtn.addEventListener('click', () => this.skip());
        if (stopBtn) stopBtn.addEventListener('click', () => this.stop());

        const mc = document.createElement('canvas');
        mc.width = 1; mc.height = 1;
        this._measureCtx = mc.getContext('2d');

        // ★ 键盘事件转发
        window.addEventListener('keydown', (e) => {
            // 1) 转发给 sub-editor 里的 HTML 扩展 iframe
            for (const iframe of this._htmlFrames.values()) {
                try {
                    iframe.contentWindow.postMessage({
                        __extKey: true,
                        event: 'down',
                        code: e.code,
                        key: e.key,
                    }, '*');
                } catch (err) { }
            }
            // 2) 转发给 game iframe（当 game tab 活跃时）
            if (UI.currentTab === 'game' &&
                typeof HostBridge !== 'undefined' &&
                HostBridge.iframeGame) {
                try {
                    const iw = HostBridge.iframeGame.contentWindow;
                    if (iw) {
                        iw.postMessage({
                            __extKey: true,
                            event: 'down',
                            code: e.code,
                            key: e.key,
                        }, '*');
                    }
                } catch (err) { }
            }
        }, { passive: false });

        window.addEventListener('keyup', (e) => {
            // game iframe 转发
            if (UI.currentTab === 'game' &&
                typeof HostBridge !== 'undefined' &&
                HostBridge.iframeGame) {
                try {
                    const iw = HostBridge.iframeGame.contentWindow;
                    if (iw) {
                        iw.postMessage({
                            __extKey: true,
                            event: 'up',
                            code: e.code,
                            key: e.key,
                        }, '*');
                    }
                } catch (err) { }
            }
            // sub-editor HTML 扩展也转发 keyup
            for (const iframe of this._htmlFrames.values()) {
                try {
                    iframe.contentWindow.postMessage({
                        __extKey: true,
                        event: 'up',
                        code: e.code,
                        key: e.key,
                    }, '*');
                } catch (err) { }
            }
        }, { passive: false });

        window.addEventListener('message', (e) => {
            const d = e.data;
            if (!d) return;
            if (d.__parkour === 'win') {
                if (this._currentStageCtx) this._currentStageCtx.parkourWin = true;
                console.log('[Player] 收到通关信号');
                return;
            }
            if (d.__from !== 'html-ext') return;
            if (d.action === 'skipCurrent') this.requestSkipCurrent();
            else if (d.action === 'skipNext') this.requestSkipNext(d.n);
            else if (d.action === 'gotoItem') this.requestGotoItem(d.id);
            else if (d.action === 'gotoScene') this.requestGotoScene(d.id);
            else if (d.action === 'end') this.requestEnd();
            else if (d.action === 'playSfx') this._playSfx(d.id, d.opts);
            else if (d.action === 'playBgm') this._playBgm(d.id, d.opts);
            else if (d.action === 'stopBgm') this._stopBgm(d.opts);
        });
    },

    setStatus(s) {
        const el = document.getElementById('player-status');
        if (el) el.textContent = s || '';
    },

    async play(scene, fromIdx) {
        if (!scene) { showToast('没有可播放的内容'); return; }
        if (!scene.items || scene.items.length === 0) { showToast('这一话没有内容'); return; }
        if (this.running) this.stop();

        // ★★★ 每次开始播放，清掉通关标记（防止上次通关残留到这一轮）
        try {
            if (window.parent && window.parent !== window) {
                window.parent.__parkourWin = false;
            }
        } catch (e) { }

        this.running = true;
        this.scene = scene;
        this.itemIdx = (typeof fromIdx === 'number') ? fromIdx : 0;
        this._jumpRequest = null;

        this._lastFrame = null;
        this._pendingOverlay = null;

        document.getElementById('player-mask').classList.add('show');
        document.getElementById('player-stage').innerHTML = '';
        this.setStatus('准备播放…');

        try {
            while (this.running && this.itemIdx < this.scene.items.length) {
                const item = this.scene.items[this.itemIdx];
                const nextItem = (this.itemIdx + 1 < this.scene.items.length)
                    ? this.scene.items[this.itemIdx + 1] : null;

                this.setStatus('[' + (this.itemIdx + 1) + '/' + this.scene.items.length + '] ' +
                    (ITEM_TYPES[item.type].name) + ' · ' + item.name);
                this._jumpRequest = null;
                await this.runItem(item, nextItem);
                if (!this.running) break;

                if (this._jumpRequest) {
                    const req = this._jumpRequest;
                    this._jumpRequest = null;
                    if (req.type === 'skipItems') {
                        this.itemIdx += 1 + (req.n || 0);
                        continue;
                    } else if (req.type === 'gotoItem') {
                        const idx = this.scene.items.findIndex(x => x.id === req.id);
                        this.itemIdx = idx >= 0 ? idx : this.itemIdx + 1;
                        continue;
                    } else if (req.type === 'gotoScene') {
                        const f = findScene(req.id);
                        if (f) { this.scene = f.scene; this.itemIdx = 0; continue; }
                        this.itemIdx++;
                        continue;
                    } else if (req.type === 'end') {
                        this.running = false;
                        break;
                    }
                }
                this.itemIdx++;
            }
        } catch (e) {
            console.error('[Player] 播放出错', e);
        }

        if (this.running) { this.setStatus('播放结束'); await this.wait(600); }
        this.stop();
    },

    stop() {
        this.running = false;
        this._skipRequested = true;
        this._jumpRequest = null;
        if (this._finishHook) { const h = this._finishHook; this._finishHook = null; h(); }
        this._stopBgm({ fade: 300 });
        this._stopAllSfx();
        this._destroyHtmlFrames();
        document.getElementById('player-mask').classList.remove('show');
        document.getElementById('player-stage').innerHTML = '';
        this._scriptCache.clear();
        this._lastErr = null;
        this._curStageAudio = null;
        this._stageRT = null;
        this._stageImgCache.clear();
        this._stageVideoCache.clear();
        this._stageEffectCanvas.clear();
        this._lastFrame = null;
        this._pendingOverlay = null;
        this._currentStageCtx = null;
    },

    skip() {
        this._skipRequested = true;
        if (this._finishHook) { const h = this._finishHook; this._finishHook = null; h(); }
    },

    requestSkipCurrent() { this._jumpRequest = { type: 'skipItems', n: 0 }; this.skip(); },
    requestSkipNext(n) { this._jumpRequest = { type: 'skipItems', n: n || 0 }; this.skip(); },
    requestGotoItem(id) { this._jumpRequest = { type: 'gotoItem', id }; this.skip(); },
    requestGotoScene(id) { this._jumpRequest = { type: 'gotoScene', id }; this.skip(); },
    requestEnd() { this._jumpRequest = { type: 'end' }; this.skip(); },

    async runItem(item, nextItem) {
        if (!this.running) return;
        if (item.type === 'room') {
            await this.runRoomItem(item);
        } else if (item.type === 'transition' || item.type === 'cg') {
            // ★ 如果是转场，预渲染下一个 stage 的一帧
            let nextFrame = null;
            if (item.type === 'transition' && nextItem &&
                (nextItem.type === 'transition' || nextItem.type === 'cg')) {
                this.setStatus('转场准备…');
                try {
                    nextFrame = await this._renderPreviewOfItem(nextItem);
                } catch (e) {
                    console.warn('[Player] 下一帧预渲染失败', e);
                }
            }
            await this.playStage(item, { nextFrame });
        }
    },

    /* ★ 预渲染任意 item 的一帧（忽略脚本动画，只画静态外观） */
    async _renderPreviewOfItem(item) {
        if (!item) return null;
        if (item.type !== 'cg' && item.type !== 'transition') return null;

        const sw = item.stageW || 1920;
        const sh = item.stageH || 1080;
        const cv = document.createElement('canvas');
        cv.width = sw;
        cv.height = sh;
        const g = cv.getContext('2d');
        g.imageSmoothingEnabled = false;

        // 铺黑
        g.fillStyle = '#000';
        g.fillRect(0, 0, sw, sh);

        // 背景色
        if (item.bgColor && item.bgColor !== 'transparent' && item.bgColor !== 'rgba(0,0,0,0)') {
            g.fillStyle = item.bgColor;
            g.fillRect(0, 0, sw, sh);
        }

        const elements = item.elements || [];

        // 收集图片，等加载（最多 250ms）
        const srcs = [];
        for (const el of elements) {
            if ((el.type === 'image' || el.type === 'gif') && el.src) srcs.push(el.src);
        }
        if (srcs.length > 0) {
            await Promise.race([
                Promise.all(srcs.map(src => new Promise(res => {
                    const img = new Image();
                    img.onload = res; img.onerror = res; img.src = src;
                }))),
                new Promise(res => setTimeout(res, 250)),
            ]);
        }

        const imgCache = new Map();
        const getImage = (src) => {
            if (!src) return null;
            if (imgCache.has(src)) return imgCache.get(src);
            const img = new Image();
            img.src = src;
            imgCache.set(src, img);
            return img;
        };

        const sorted = elements.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        for (const el of sorted) {
            if (el.visible === false) continue;
            if (el.type === 'html') continue;
            // panel: 如果初始不可见就跳过
            if (el.type === 'panel' && el.visibleOnStart === false) continue;
            g.save();
            g.globalAlpha = el.opacity != null ? el.opacity : 1;
            if (el.rotation) {
                const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
                g.translate(cx, cy);
                g.rotate(el.rotation * Math.PI / 180);
                g.translate(-cx, -cy);
            }
            try {
                drawStageElement(g, el, {
                    getImage,
                    getVideo: () => null,
                    getEffect: () => null,
                });
            } catch (e) { /* 跳过问题元素 */ }
            g.restore();
        }

        return cv;
    },

    async runRoomItem(item) {
        const r = WORKSPACE.rooms[item.roomId];
        if (!r || !r.zipBuffer) { this.setStatus('房间未选择，跳过'); await this.wait(500); return; }
        this.setStatus('切换房间：' + (r.name || item.roomId));

        document.getElementById('player-mask').classList.remove('show');
        switchTab('game');
        await HostBridge._waitForGameReady();
        Bridge.sendTo(HostBridge.iframeGame, 'load-room-zip', {
            zipBuffer: r.zipBuffer,
            items: WORKSPACE.items || {},
        });
        await new Promise(resolve => {
            const t = setTimeout(resolve, 5000);
            Bridge.on('game-loaded', function once() {
                clearTimeout(t); Bridge.off('game-loaded', once); resolve();
            });
        });
        if (!this.running) return;

        if (item.autoNext) {
            this.setStatus('房间自动继续（3秒）…');
            await this.wait(3000);
            if (this._skipRequested) { this._skipRequested = false; return; }
        } else {
            this.setStatus('房间中…（点「跳过」继续）');
            await this._waitUntilSkip();
        }
        Bridge.sendTo(HostBridge.iframeGame, 'game-stop', {});
        switchTab('story');
        document.getElementById('player-mask').classList.add('show');
    },

    _destroyHtmlFrames() {
        for (const iframe of this._htmlFrames.values()) {
            try { iframe.remove(); } catch (e) { }
        }
        this._htmlFrames.clear();
    },

    _createHtmlFrame(el) {
        const iframe = document.createElement('iframe');
        iframe.style.cssText =
            'position:absolute;border:0;background:transparent;' +
            'pointer-events:' + (el.pointerEvents !== false ? 'auto' : 'none') + ';';
        iframe.style.left = el.x + 'px';
        iframe.style.top = el.y + 'px';
        iframe.style.width = el.w + 'px';
        iframe.style.height = el.h + 'px';
        iframe.style.zIndex = el.zIndex || 0;
        iframe.style.opacity = el.opacity != null ? el.opacity : 1;
        if (el.rotation) iframe.style.transform = 'rotate(' + el.rotation + 'deg)';

        iframe.srcdoc = this._wrapHtmlDoc(el.html || '', el.allowScripts !== false);

        this._htmlFrames.set(el.id, iframe);
        return iframe;
    },

    _wrapHtmlDoc(userHtml, allowScripts) {
        const csp = allowScripts ? '' : '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">';
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
${csp}
<style>
    html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:transparent; }
    * { box-sizing:border-box; }
</style>
</head>
<body>
${userHtml}
<script>
    window.game = {
        skipCurrent: function () { parent.postMessage({__from:'html-ext', action:'skipCurrent'}, '*'); },
        skipNext: function (n) { parent.postMessage({__from:'html-ext', action:'skipNext', n: n||0}, '*'); },
        gotoItem: function (id) { parent.postMessage({__from:'html-ext', action:'gotoItem', id:id}, '*'); },
        gotoScene: function (id) { parent.postMessage({__from:'html-ext', action:'gotoScene', id:id}, '*'); },
        end: function () { parent.postMessage({__from:'html-ext', action:'end'}, '*'); },
        playSfx: function (id, opts) { parent.postMessage({__from:'html-ext', action:'playSfx', id:id, opts:opts}, '*'); },
        playBgm: function (id, opts) { parent.postMessage({__from:'html-ext', action:'playBgm', id:id, opts:opts}, '*'); },
        stopBgm: function (opts) { parent.postMessage({__from:'html-ext', action:'stopBgm', opts:opts}, '*'); },
    };
    window.gameCtx = window.game;
</script>
</body>
</html>`;
    },

    _captureFrame(cv) {
        if (!cv || cv.width <= 0 || cv.height <= 0) return;
        if (!this._lastFrame) {
            this._lastFrame = document.createElement('canvas');
        }
        const lf = this._lastFrame;
        if (lf.width !== cv.width || lf.height !== cv.height) {
            lf.width = cv.width;
            lf.height = cv.height;
        }
        const lfCtx = lf.getContext('2d');
        lfCtx.clearRect(0, 0, lf.width, lf.height);
        try { lfCtx.drawImage(cv, 0, 0); } catch (e) { }
    },

    playStage(item, opts) {
        opts = opts || {};
        const nextFramePreview = opts.nextFrame || null;

        const rt = JSON.parse(JSON.stringify(item, function (k, v) {
            if (k === '_runtime' || k === '_iconImageEl') return undefined;
            return v;
        }));
        for (const el of (rt.elements || [])) el._runtime = {};
        for (const el of (rt.elements || [])) {
            if (el.type === 'panel') el.visible = (el.visibleOnStart !== false);
        }

        this._curStageAudio = rt.audioAssets || {};
        this._stageRT = rt;

        const mask = document.getElementById('player-mask');
        const container = document.getElementById('player-stage');
        mask.classList.add('show');
        container.innerHTML = '';

        this._destroyHtmlFrames();

        const cv = document.createElement('canvas');
        cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:0;';
        container.appendChild(cv);
        const ctx = cv.getContext('2d');

        const htmlLayer = document.createElement('div');
        htmlLayer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:1;pointer-events:none;';
        container.appendChild(htmlLayer);

        const sw = rt.stageW || 1920;
        const sh = rt.stageH || 1080;

        const isTransition = (rt.type === 'transition');
        const transitionType = rt.transitionType || 'fade';
        const isWipe = isTransition && transitionType === 'wipe';
        const isCustom = isTransition && transitionType === 'custom';
        const prevFrame = this._lastFrame;
        const pendingOverlay = this._pendingOverlay;
        this._pendingOverlay = null;

        // 设置 stage 上下文（脚本可读 prevFrame / nextFrame / parkourWin）
        this._currentStageCtx = {
            isTransition: isTransition,
            transitionType: transitionType,
            prevFrame: prevFrame,
            nextFrame: nextFramePreview,
            stageW: sw,
            stageH: sh,
            parkourWin: false,
        };

        let localOverlay = null;
        if (isTransition) {
            const dur = Math.max(0, Number(rt.transitionFadeIn) || (isWipe ? 800 : 500)) / 1000;
            localOverlay = {
                color: rt.transitionColor || '0,0,0',
                alpha: 0,
                targetAlpha: 1,
                dur: dur,
            };
        } else if (pendingOverlay) {
            const fo = Number(pendingOverlay.fadeOut);
            localOverlay = {
                color: pendingOverlay.color,
                alpha: pendingOverlay.alpha,
                targetAlpha: 0,
                dur: isFinite(fo) && fo >= 0 ? fo : 0.5,
            };
        }

        const imgCache = this._stageImgCache;
        const videoCache = new Map();
        const effectCanvas = new Map();

        for (const el of (rt.elements || [])) {
            if (el.type === 'video' && el.src) {
                const v = document.createElement('video');
                v.muted = el.muted !== false;
                v.playsInline = true;
                v.autoplay = true;
                v.loop = el.loop !== false;
                v.src = el.src;
                v.play && v.play().catch(() => { });
                videoCache.set(el.id, v);
            }
        }
        for (const el of (rt.elements || [])) {
            if (el.type === 'effect') {
                const ec = document.createElement('canvas');
                ec.width = Math.max(1, Math.round(el.w));
                ec.height = Math.max(1, Math.round(el.h));
                effectCanvas.set(el.id, ec);
            }
        }

        const getImage = (src) => {
            if (!src) return null;
            if (imgCache.has(src)) return imgCache.get(src);
            const img = new Image();
            img.src = src;
            imgCache.set(src, img);
            return img;
        };
        const drawCache = {
            getImage,
            getVideo: (id) => videoCache.get(id),
            getEffect: (id) => effectCanvas.get(id),
        };

        let scale = 1, ox = 0, oy = 0;
        const resize = () => {
            const w = window.innerWidth, h = window.innerHeight;
            const dpr = window.devicePixelRatio || 1;
            cv.width = Math.floor(w * dpr);
            cv.height = Math.floor(h * dpr);
            cv.style.width = w + 'px';
            cv.style.height = h + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.imageSmoothingEnabled = false;
            scale = Math.min(w / sw, h / sh);
            ox = (w - sw * scale) / 2;
            oy = (h - sh * scale) / 2;
            this._stageScale = scale;
            this._stageOX = ox;
            this._stageOY = oy;

            htmlLayer.style.transformOrigin = 'top left';
            htmlLayer.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + scale + ')';
            htmlLayer.style.width = sw + 'px';
            htmlLayer.style.height = sh + 'px';
        };
        resize();

        // ★★★ 关键修复：所有 HTML 元素都创建 iframe，不管初始可见与否
        for (const el of (rt.elements || [])) {
            if (el.type !== 'html') continue;
            const iframe = this._createHtmlFrame(el);
            htmlLayer.appendChild(iframe);
        }

        const applyHtmlVisibility = () => {
            for (const el of (rt.elements || [])) {
                if (el.type !== 'html') continue;
                const iframe = this._htmlFrames.get(el.id);
                if (!iframe) continue;
                iframe.style.display = el.visible === false ? 'none' : '';
                iframe.style.left = el.x + 'px';
                iframe.style.top = el.y + 'px';
                iframe.style.width = el.w + 'px';
                iframe.style.height = el.h + 'px';
                iframe.style.zIndex = el.zIndex || 0;
                iframe.style.opacity = el.opacity != null ? el.opacity : 1;
                iframe.style.transform = el.rotation ? 'rotate(' + el.rotation + 'deg)' : '';
                iframe.style.pointerEvents = el.pointerEvents !== false ? 'auto' : 'none';
            }
        };
        applyHtmlVisibility();

        const screenToStage = (sx, sy) => ({
            x: (sx - ox) / scale,
            y: (sy - oy) / scale,
        });

        const hitElement = (sx, sy) => {
            const sp = screenToStage(sx, sy);
            const sorted = (rt.elements || []).slice().sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
            for (const el of sorted) {
                if (el.visible === false) continue;
                if (el.type === 'html') continue;
                let px = sp.x, py = sp.y;
                if (el.rotation) {
                    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
                    const a = -el.rotation * Math.PI / 180;
                    const cos = Math.cos(a), sin = Math.sin(a);
                    const dx = px - cx, dy = py - cy;
                    px = cx + dx * cos - dy * sin;
                    py = cy + dx * sin + dy * cos;
                }
                if (el.type === 'circleBtn') {
                    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
                    const r = Math.min(el.w, el.h) / 2 + 4;
                    if (Math.hypot(px - cx, py - cy) <= r) return el;
                } else if (el.type === 'panel') {
                    if (!el.clickable) continue;
                    if (px >= el.x && px <= el.x + el.w && py >= el.y && py <= el.y + el.h) return el;
                } else {
                    if (px >= el.x && px <= el.x + el.w && py >= el.y && py <= el.y + el.h) return el;
                }
            }
            return null;
        };

        return new Promise(resolve => {
            let finished = false;
            let autoFinished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                this._finishHook = null;

                this._captureFrame(cv);
                this._currentStageCtx = null;

                if (isTransition) {
                    if (isWipe || isCustom) {
                        this._pendingOverlay = null;
                    } else {
                        this._pendingOverlay = {
                            color: rt.transitionColor || '0,0,0',
                            alpha: 1,
                            fadeOut: Math.max(0, Number(rt.transitionFadeOut) || 500) / 1000,
                        };
                    }
                }

                if (rt.onEnd) this._runScript(rt.onEnd, this._makeStageEnv(sw, sh, null), 'stage.onEnd');
                if (this.stopBgmOnStageEnd) this._stopBgm({ fade: 300 });
                this._stopAllSfx();
                mask.removeEventListener('click', onClick);
                window.removeEventListener('resize', resize);
                for (const v of videoCache.values()) { try { v.pause(); } catch (e) { } }
                this._destroyHtmlFrames();
                resolve();
            };
            this._finishHook = finish;

            const onClick = (e) => {
                const rect = mask.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const hit = hitElement(sx, sy);
                if (hit && (hit.type === 'button' || hit.type === 'circleBtn' || (hit.type === 'panel' && hit.clickable))) {
                    e.stopPropagation();
                    applyToggleTarget(rt, hit);
                    applyHtmlVisibility();
                    if (hit.onClick) {
                        this._runScript(hit.onClick, this._makeEnv(hit, effectCanvas), 'el.onClick');
                    }
                    return;
                }
                if (rt.finishMode === 'click') finish();
            };
            mask.addEventListener('click', onClick);
            window.addEventListener('resize', resize);

            for (const el of (rt.elements || [])) {
                if (el.onStart) {
                    this._runScript(el.onStart, this._makeEnv(el, effectCanvas), 'el.onStart');
                }
            }
            if (rt.onStart) {
                this._runScript(rt.onStart, this._makeStageEnv(sw, sh, finish), 'stage.onStart');
            }

            if (rt.finishMode === 'timeout') {
                setTimeout(finish, rt.finishAfter || 3000);
            }

            let lastT = performance.now();
            const tick = () => {
                if (finished || !this.running) {
                    if (!finished) finish();
                    return;
                }
                const now = performance.now();
                const dt = Math.min(0.05, (now - lastT) / 1000);
                lastT = now;

                for (const el of (rt.elements || [])) {
                    if (el.onUpdate) {
                        const env = this._makeEnv(el, effectCanvas);
                        env.dt = dt;
                        this._runScript(el.onUpdate, env, 'el.onUpdate');
                    }
                }
                if (rt.onUpdate) {
                    const env = this._makeStageEnv(sw, sh, finish);
                    env.dt = dt;
                    this._runScript(rt.onUpdate, env, 'stage.onUpdate');
                }

                applyHtmlVisibility();

                const w = window.innerWidth, h = window.innerHeight;
                ctx.clearRect(0, 0, w, h);
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, w, h);

                ctx.save();
                ctx.translate(ox, oy);
                ctx.scale(scale, scale);

                if (localOverlay) {
                    const diff = localOverlay.targetAlpha - localOverlay.alpha;
                    if (Math.abs(diff) > 0.001) {
                        const step = dt / Math.max(0.001, localOverlay.dur);
                        const dir = Math.sign(diff);
                        localOverlay.alpha += dir * step;
                        if ((dir > 0 && localOverlay.alpha >= localOverlay.targetAlpha) ||
                            (dir < 0 && localOverlay.alpha <= localOverlay.targetAlpha)) {
                            localOverlay.alpha = localOverlay.targetAlpha;
                        }
                    }
                }

                if (isTransition && prevFrame) {
                    try {
                        ctx.drawImage(prevFrame, 0, 0, prevFrame.width, prevFrame.height, 0, 0, sw, sh);
                    } catch (e) { }
                }

                if (isWipe && nextFramePreview) {
                    const p = localOverlay ? Math.min(1, Math.max(0, localOverlay.alpha)) : 0;
                    const dir = rt.wipeDirection || 'right';
                    try {
                        if (dir === 'right') {
                            const reveal = sw * p;
                            ctx.drawImage(nextFramePreview, 0, 0,
                                nextFramePreview.width * p, nextFramePreview.height,
                                0, 0, reveal, sh);
                        } else if (dir === 'left') {
                            const reveal = sw * p;
                            ctx.drawImage(nextFramePreview,
                                nextFramePreview.width * (1 - p), 0,
                                nextFramePreview.width * p, nextFramePreview.height,
                                sw - reveal, 0, reveal, sh);
                        } else if (dir === 'down') {
                            const reveal = sh * p;
                            ctx.drawImage(nextFramePreview, 0, 0,
                                nextFramePreview.width, nextFramePreview.height * p,
                                0, 0, sw, reveal);
                        } else if (dir === 'up') {
                            const reveal = sh * p;
                            ctx.drawImage(nextFramePreview,
                                0, nextFramePreview.height * (1 - p),
                                nextFramePreview.width, nextFramePreview.height * p,
                                0, sh - reveal, sw, reveal);
                        }
                    } catch (e) { }
                }

                if (rt.bgColor && rt.bgColor !== 'transparent' && rt.bgColor !== 'rgba(0,0,0,0)') {
                    ctx.fillStyle = rt.bgColor;
                    ctx.fillRect(0, 0, sw, sh);
                }

                const sorted = (rt.elements || []).slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
                for (const el of sorted) {
                    if (el.visible === false) continue;
                    if (el.type === 'html') continue;
                    ctx.save();
                    ctx.globalAlpha = el.opacity != null ? el.opacity : 1;
                    if (el.rotation) {
                        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
                        ctx.translate(cx, cy);
                        ctx.rotate(el.rotation * Math.PI / 180);
                        ctx.translate(-cx, -cy);
                    }
                    drawStageElement(ctx, el, drawCache);
                    ctx.restore();
                }
                ctx.restore();

                if (localOverlay && !isWipe && !isCustom) {
                    if (localOverlay.alpha > 0.001) {
                        ctx.fillStyle = 'rgba(' + localOverlay.color + ',' + localOverlay.alpha + ')';
                        ctx.fillRect(0, 0, w, h);
                    }
                }

                if (isTransition && !isCustom && !autoFinished &&
                    localOverlay && localOverlay.alpha >= 1 && localOverlay.targetAlpha === 1) {
                    autoFinished = true;
                    if (rt.finishMode !== 'click') {
                        setTimeout(() => { if (!finished) finish(); }, 30);
                    }
                }

                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    },

    _makeEnv(el, effectCanvas) {
        const self = this;
        if (!el._runtime) el._runtime = {};

        if (!self._measureCtx) {
            const mc = document.createElement('canvas');
            mc.width = 1; mc.height = 1;
            self._measureCtx = mc.getContext('2d');
        }

        const extras = {
            dt: 0.016,
            log: console.log,
            ctx2d: self._measureCtx,
            measureText: (text, fontSize, fontFamily) => {
                self._measureCtx.font = (fontSize || 16) + 'px ' + (fontFamily || 'sans-serif');
                return self._measureCtx.measureText(String(text)).width;
            },
            playSfx: (id, opts) => self._playSfx(id, opts),
            playBgm: (id, opts) => self._playBgm(id, opts),
            stopBgm: (a, b) => self._stopBgm(a, b),
            fadeBgmTo: (a, b, c) => self._fadeBgmTo(a, b, c),
            story: {
                skipCurrent: () => self.requestSkipCurrent(),
                skipNext: (n) => self.requestSkipNext(n),
                gotoItem: (id) => self.requestGotoItem(id),
                gotoScene: (id) => self.requestGotoScene(id),
                end: () => self.requestEnd(),
            },
        };
        extras.state = el._runtime;

        // ★ 转场上下文 + 通关状态
        if (self._currentStageCtx) {
            extras.prevFrame = self._currentStageCtx.prevFrame;
            extras.nextFrame = self._currentStageCtx.nextFrame;
            extras.stageW = self._currentStageCtx.stageW;
            extras.stageH = self._currentStageCtx.stageH;
            extras.isTransition = self._currentStageCtx.isTransition;
            extras.transitionType = self._currentStageCtx.transitionType;
            extras.parkourWin = !!self._currentStageCtx.parkourWin;
        }

        if (el.type === 'effect' && effectCanvas) {
            const ec = effectCanvas.get(el.id);
            extras.canvas = ec;
            extras.ctx2d = ec ? ec.getContext('2d') : self._measureCtx;
        }

        if (el.type === 'html') {
            const iframe = self._htmlFrames.get(el.id);
            extras.iframe = iframe || null;
            extras.window = iframe ? iframe.contentWindow : null;
            extras.document = iframe ? iframe.contentDocument : null;
            extras.dom = iframe ? iframe.contentDocument : null;
            extras.post = (msg) => {
                if (iframe) {
                    try { iframe.contentWindow.postMessage(msg, '*'); } catch (e) { }
                }
            };
        }

        return new Proxy(extras, {
            get(t, k) { if (k in t) return t[k]; return el[k]; },
            set(t, k, v) { if (k in t) { t[k] = v; return true; } el[k] = v; return true; },
            has(t, k) { return (k in t) || (k in el); },
        });
    },
    _makeStageEnv(w, h, finishFn) {
        const self = this;

        if (!self._measureCtx) {
            const mc = document.createElement('canvas');
            mc.width = 1; mc.height = 1;
            self._measureCtx = mc.getContext('2d');
        }

        const env = {
            width: w, height: h,
            dt: 0.016,
            log: console.log,
            finish: finishFn,
            ctx2d: self._measureCtx,
            measureText: (text, fontSize, fontFamily) => {
                self._measureCtx.font = (fontSize || 16) + 'px ' + (fontFamily || 'sans-serif');
                return self._measureCtx.measureText(String(text)).width;
            },
            playSfx: (id, opts) => self._playSfx(id, opts),
            playBgm: (id, opts) => self._playBgm(id, opts),
            stopBgm: (a, b) => self._stopBgm(a, b),
            fadeBgmTo: (a, b, c) => self._fadeBgmTo(a, b, c),
            story: {
                skipCurrent: () => self.requestSkipCurrent(),
                skipNext: (n) => self.requestSkipNext(n),
                gotoItem: (id) => self.requestGotoItem(id),
                gotoScene: (id) => self.requestGotoScene(id),
                end: () => self.requestEnd(),
            },
        };

        if (self._currentStageCtx) {
            env.prevFrame = self._currentStageCtx.prevFrame;
            env.nextFrame = self._currentStageCtx.nextFrame;
            env.stageW = self._currentStageCtx.stageW;
            env.stageH = self._currentStageCtx.stageH;
            env.isTransition = self._currentStageCtx.isTransition;
            env.transitionType = self._currentStageCtx.transitionType;
            env.parkourWin = !!self._currentStageCtx.parkourWin;
        }

        return env;
    },

    _runScript(code, env, tag) {
        if (!code || !code.trim()) return;
        try {
            let fn = this._scriptCache.get(code);
            if (!fn) {
                fn = new Function('self', 'dt', code);
                this._scriptCache.set(code, fn);
            }
            fn(env, env.dt || 0.016);
        } catch (e) {
            console.error('[' + tag + ']', e);
        }
    },

    _getAudioAsset(idOrName) {
        if (!this._curStageAudio) return null;
        if (this._curStageAudio[idOrName]) return this._curStageAudio[idOrName];
        for (const k of Object.keys(this._curStageAudio)) {
            if (this._curStageAudio[k].name === idOrName) return this._curStageAudio[k];
        }
        return null;
    },

    _playSfx(idOrName, opts) {
        opts = opts || {};
        const a = this._getAudioAsset(idOrName);
        if (!a) return;
        const audio = new Audio(a.src);
        audio.volume = opts.volume != null ? opts.volume : 1.0;
        audio.play().catch(() => { });
        this._sfxList.push(audio);
        audio.addEventListener('ended', () => {
            const i = this._sfxList.indexOf(audio);
            if (i >= 0) this._sfxList.splice(i, 1);
        });
    },

    _playBgm(idOrName, opts) {
        opts = opts || {};
        const a = this._getAudioAsset(idOrName);
        if (!a) {
            console.warn('[BGM] 找不到音频素材：' + idOrName);
            return;
        }

        if (this._bgmAudios.has(a.id)) {
            if (!opts.restart) {
                console.log('[BGM] 已在播放，跳过：' + a.name);
                return;
            }
            const existing = this._bgmAudios.get(a.id);
            const oldAudio = existing.audio;
            if (opts.fade > 0) {
                this._fadeAudio(oldAudio, 0, opts.fade, () => { try { oldAudio.pause(); } catch (e) { } });
            } else {
                try { oldAudio.pause(); } catch (e) { }
            }
            this._bgmAudios.delete(a.id);
        }

        const audio = new Audio(a.src);
        audio.loop = opts.loop !== false;
        const targetVol = opts.volume != null ? opts.volume : 0.7;
        audio.volume = opts.fade > 0 ? 0 : targetVol;

        console.log('[BGM] 尝试播放：' + a.name + ' | 目标音量 ' + targetVol + ' | 淡入 ' + (opts.fade || 0) + 'ms');

        audio.play().then(() => {
            console.log('[BGM] ✓ 播放开始：' + a.name);
        }).catch((err) => {
            console.warn('[BGM] ✗ 播放被拒绝：' + a.name, err);
        });

        if (opts.fade > 0) this._fadeAudio(audio, targetVol, opts.fade, null);

        this._bgmAudios.set(a.id, {
            id: a.id,
            name: a.name,
            audio: audio,
            targetVolume: targetVol,
        });
    },

    _stopBgm(arg1, arg2) {
        let idOrName = null;
        let opts = {};
        if (typeof arg1 === 'string') {
            idOrName = arg1;
            opts = arg2 || {};
        } else if (arg1 && typeof arg1 === 'object') {
            opts = arg1;
        }

        const fade = opts.fade != null ? opts.fade : 0;

        const toStop = [];
        if (idOrName == null || idOrName === '') {
            // 空 → 停所有
            for (const entry of this._bgmAudios.values()) toStop.push(entry);
        } else {
            const wantId = String(idOrName);
            const wantTrim = wantId.trim();
            const wantLower = wantTrim.toLowerCase();

            for (const entry of this._bgmAudios.values()) {
                const eid = String(entry.id);
                const ename = String(entry.name || '');
                const enameTrim = ename.trim();

                // 1. id 完全匹配
                if (eid === wantId) { toStop.push(entry); continue; }
                // 2. name 完全匹配
                if (ename === wantId || enameTrim === wantTrim) { toStop.push(entry); continue; }
                // 3. name 忽略大小写
                if (enameTrim.toLowerCase() === wantLower) { toStop.push(entry); continue; }
                // 4. name 包含（最宽容的兜底）
                if (enameTrim && (enameTrim.indexOf(wantTrim) >= 0 || wantTrim.indexOf(enameTrim) >= 0)) {
                    toStop.push(entry);
                    continue;
                }
            }
        }

        for (const entry of toStop) {
            const audio = entry.audio;
            if (fade > 0) {
                this._fadeAudio(audio, 0, fade, () => {
                    // 淡出结束后，强制静音 + 暂停 + 归零
                    try { audio.muted = true; } catch (e) { }
                    try { audio.pause(); } catch (e) { }
                    try { audio.currentTime = 0; } catch (e) { }
                });
            } else {
                try { audio.muted = true; } catch (e) { }
                try { audio.pause(); } catch (e) { }
                try { audio.currentTime = 0; } catch (e) { }
            }
            this._bgmAudios.delete(entry.id);
        }

        if (toStop.length === 0 && idOrName != null && idOrName !== '') {
            console.warn('[BGM] stopBgm 未匹配到：' + idOrName +
                '  当前在播：' + Array.from(this._bgmAudios.values()).map(e => e.id + '/' + e.name).join(', '));
        }
    },

    _fadeBgmTo(arg1, arg2, arg3) {
        let idOrName = null;
        let vol, ms;
        if (typeof arg1 === 'string') {
            idOrName = arg1;
            vol = arg2;
            ms = arg3;
        } else {
            vol = arg1;
            ms = arg2;
        }

        const list = [];
        if (idOrName == null) {
            for (const entry of this._bgmAudios.values()) list.push(entry);
        } else {
            if (this._bgmAudios.has(idOrName)) {
                list.push(this._bgmAudios.get(idOrName));
            } else {
                for (const entry of this._bgmAudios.values()) {
                    if (entry.name === idOrName) list.push(entry);
                }
            }
        }

        for (const entry of list) {
            this._fadeAudio(entry.audio, vol, ms, null);
            entry.targetVolume = vol;
        }
    },

    _fadeAudio(audio, toVol, ms, onDone) {
        const fromVol = audio.volume;
        const steps = 16; let i = 0;
        const tick = () => {
            i++;
            if (i > steps || !audio) { audio.volume = toVol; if (onDone) onDone(); return; }
            audio.volume = fromVol + (toVol - fromVol) * (i / steps);
            setTimeout(tick, ms / steps);
        };
        tick();
    },

    _stopAllSfx() {
        for (const a of this._sfxList) { try { a.pause(); } catch (e) { } }
        this._sfxList = [];
    },

    wait(ms) {
        return new Promise(resolve => {
            if (!this.running) return resolve();
            const t = setTimeout(() => { this._waitResolve = null; resolve(); }, ms);
            this._waitResolve = () => { clearTimeout(t); resolve(); };
        });
    },
    _waitUntilSkip() {
        return new Promise(resolve => {
            if (this._skipRequested) { this._skipRequested = false; return resolve(); }
            const t = setInterval(() => {
                if (!this.running || this._skipRequested) {
                    clearInterval(t); this._skipRequested = false; resolve();
                }
            }, 100);
        });
    },
};