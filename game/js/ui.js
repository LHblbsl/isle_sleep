/* ============================================================
   对话 / 选项 / 淡入淡出
   ★ 对话框改用 canvas 绘制（跟 RoomUI 面板同款：圆角 + 边框 + 打字机 + 点击继续）
   ============================================================ */

const UI = {
    dialogueCanvas: null,
    dialogueCtx: null,
    choiceEl: null,
    fadeCanvas: null,
    fadeCtx: null,
    fadeAlpha: 0,
    fadeTarget: 0,
    fadeSpeed: 1,
    _fadeResolve: null,
    _interactTarget: null,
    _dlg: null,
    _dlgRAF: null,

    init() {
        this.dialogueCanvas = document.getElementById('dialogue-canvas');
        if (this.dialogueCanvas) {
            this.dialogueCtx = this.dialogueCanvas.getContext('2d');
        }
        this.choiceEl = document.getElementById('choice-layer');

        const c = document.createElement('canvas');
        c.style.position = 'absolute';
        c.style.pointerEvents = 'none';
        c.style.zIndex = '60';
        document.getElementById('game-root').appendChild(c);
        this.fadeCanvas = c;
        this.fadeCtx = c.getContext('2d');
    },

    resize(logicalW, logicalH, displayW, displayH, dx, dy) {
        // 淡入淡出 canvas
        this.fadeCanvas.width = logicalW;
        this.fadeCanvas.height = logicalH;
        const fs = this.fadeCanvas.style;
        fs.width = displayW + 'px';
        fs.height = displayH + 'px';
        fs.left = dx + 'px';
        fs.top = dy + 'px';

        // 对话框 canvas
        if (this.dialogueCanvas) {
            this.dialogueCanvas.width = logicalW;
            this.dialogueCanvas.height = logicalH;
            const ds = this.dialogueCanvas.style;
            ds.width = displayW + 'px';
            ds.height = displayH + 'px';
            ds.left = dx + 'px';
            ds.top = dy + 'px';
        }
    },

    /* ============================================================
       对话（canvas 绘制）
       ============================================================ */
    showDialogue(text, name, opts) {
        opts = opts || {};
        const self = this;

        // 前一个还没结束 → 强制关掉
        if (this._dlg) {
            const old = this._dlg;
            if (old._onPointer) this.dialogueCanvas.removeEventListener('pointerdown', old._onPointer);
            if (old._onKey) window.removeEventListener('keydown', old._onKey);
            if (old.resolve) old.resolve();
            this._dlg = null;
        }

        return new Promise(resolve => {
            const cv = this.dialogueCanvas;
            const ctx = this.dialogueCtx;
            if (!cv || !ctx) { resolve(); return; }

            const W = cv.width;
            const H = cv.height;

            const FONT_SIZE = 22;
            const TITLE_FONT_SIZE = 14;
            const PAD_X = 46;
            const PAD_TOP = 42;
            const PAD_BOTTOM = 32;
            const MIN_W = 200;
            const MAX_W = W - 100;

            // 测文字宽度
            ctx.font = FONT_SIZE + 'px system-ui, -apple-system, "PingFang SC", sans-serif';
            const textW = ctx.measureText(text).width;

            const targetW = Math.max(MIN_W, Math.min(MAX_W, textW + PAD_X * 2));
            const boxH = PAD_TOP + PAD_BOTTOM + FONT_SIZE * 1.4;

            const cx = W / 2;
            const baseY = H - 60 - boxH;    // 底部往上 60
            const baseX = cx - targetW / 2;

            const dlg = {
                text: text,
                name: name || '',
                nameColor: opts.nameColor || '#7ac8e0',
                targetW: targetW,
                curW: 0,
                baseX: baseX,
                baseY: baseY,
                centerX: cx,
                boxH: boxH,
                phase: 'in',              // in → typing → waiting → out
                t: 0,
                textProgress: 0,
                clicked: false,
                font: FONT_SIZE,
                titleFont: TITLE_FONT_SIZE,
                PAD_X: PAD_X,
                PAD_TOP: PAD_TOP,
                PAD_BOTTOM: PAD_BOTTOM,
                resolve: resolve,
            };
            this._dlg = dlg;

            cv.style.display = 'block';
            cv.classList.add('show');

            const onPointer = function (e) {
                if (self._dlg !== dlg) return;
                if (dlg.phase === 'typing') {
                    dlg.textProgress = dlg.text.length;
                    dlg.phase = 'waiting';
                    dlg.t = 0;
                    return;
                }
                if (dlg.phase === 'waiting') {
                    dlg.clicked = true;
                }
            };
            const onKey = function (e) {
                if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE') {
                    e.preventDefault();
                    onPointer(e);
                }
            };
            dlg._onPointer = onPointer;
            dlg._onKey = onKey;
            cv.addEventListener('pointerdown', onPointer);
            window.addEventListener('keydown', onKey);

            this._startDialogueLoop();
        });
    },

    _startDialogueLoop() {
        if (this._dlgRAF) return;
        const self = this;
        let lastT = performance.now();
        const loop = (t) => {
            if (!self._dlg) {
                self._dlgRAF = null;
                return;
            }
            const dt = Math.min(0.05, (t - lastT) / 1000);
            lastT = t;
            self._updateDialogue(dt);
            self._renderDialogue();
            self._dlgRAF = requestAnimationFrame(loop);
        };
        this._dlgRAF = requestAnimationFrame(loop);
    },

    _updateDialogue(dt) {
        const d = this._dlg;
        if (!d) return;

        if (d.phase === 'in') {
            d.t += dt;
            const p = Math.min(1, d.t / 0.3);
            const e = 1 - Math.pow(1 - p, 3);
            d.curW = d.targetW * e;
            if (p >= 1) {
                d.curW = d.targetW;
                d.phase = 'typing';
                d.t = 0;
                d.textProgress = 0;
            }
        }
        else if (d.phase === 'typing') {
            d.t += dt;
            const PER_CHAR = 0.05;               // ★ 每字 0.05 秒
            d.textProgress = Math.min(d.text.length, d.t / PER_CHAR);
            if (d.textProgress >= d.text.length) {
                d.textProgress = d.text.length;
                d.phase = 'waiting';
                d.t = 0;
            }
        }
        else if (d.phase === 'waiting') {
            if (d.clicked) {
                d.phase = 'out';
                d.t = 0;
            }
        }
        else if (d.phase === 'out') {
            d.t += dt;
            const p = Math.min(1, d.t / 0.25);
            const e = 1 - Math.pow(1 - p, 3);
            d.curW = d.targetW * (1 - e);
            if (p >= 1) {
                if (d._onPointer) this.dialogueCanvas.removeEventListener('pointerdown', d._onPointer);
                if (d._onKey) window.removeEventListener('keydown', d._onKey);
                this.dialogueCanvas.style.display = 'none';
                this.dialogueCanvas.classList.remove('show');
                const r = d.resolve;
                this._dlg = null;
                if (r) r();
            }
        }
    },

    _renderDialogue() {
        const d = this._dlg;
        const ctx = this.dialogueCtx;
        const cv = this.dialogueCanvas;
        if (!d || !ctx || !cv) return;

        const W = cv.width;
        const H = cv.height;
        ctx.clearRect(0, 0, W, H);

        const curW = d.curW;
        const x = d.centerX - curW / 2;
        const y = d.baseY;
        const w = curW;
        const h = d.boxH;
        const r = 16;

        let alpha = 1;
        if (d.phase === 'in') alpha = Math.min(1, d.t / 0.3);
        else if (d.phase === 'out') alpha = Math.max(0, 1 - d.t / 0.25);

        ctx.save();
        ctx.globalAlpha = alpha;

        // 阴影
        this._roundRect(ctx, x + 5, y + 7, w, h, r);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fill();

        // 外边框
        this._roundRect(ctx, x - 2, y - 2, w + 4, h + 4, r + 2);
        ctx.fillStyle = '#6ec8e0';
        ctx.fill();

        // 内背景
        this._roundRect(ctx, x, y, w, h, r);
        ctx.fillStyle = '#141c2a';
        ctx.fill();

        // 高光 / 阴影边
        ctx.save();
        this._roundRect(ctx, x, y, w, h, r);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, y, w, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(x, y + h - 2, w, 2);
        ctx.restore();

        // 标题
        if (d.name) {
            ctx.fillStyle = d.nameColor;
            ctx.font = 'bold ' + d.titleFont + 'px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(d.name, x + 16, y + 10);
        }

        // 正文（打字机）
        const full = String(d.text || '');
        const prog = Math.floor(d.textProgress || 0);
        const shown = full.slice(0, prog);
        if (shown) {
            ctx.fillStyle = '#e8e8ea';
            ctx.font = d.font + 'px system-ui, -apple-system, "PingFang SC", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const hintShift = (d.phase === 'waiting') ? 8 : 0;
            ctx.fillText(shown, x + w / 2, y + h / 2 - hintShift + 4);
        }

        // "点击继续" 闪烁
        if (d.phase === 'waiting') {
            ctx.save();
            const blink = 0.5 + 0.5 * Math.sin(performance.now() / 400);
            ctx.globalAlpha *= blink;
            ctx.fillStyle = '#7ac8e0';
            ctx.font = '13px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('点击继续', x + w / 2, y + h - 8);
            ctx.restore();
        }

        ctx.restore();
    },

    _roundRect(ctx, x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    /* ============================================================
       选项（DOM，保持不变）
       ============================================================ */
    showChoice(options) {
        return new Promise(resolve => {
            const el = this.choiceEl;
            el.innerHTML = '';
            const box = document.createElement('div');
            box.className = 'choice-box';
            options.forEach((opt, i) => {
                const btn = document.createElement('button');
                btn.className = 'choice-btn';
                btn.textContent = opt;
                btn.addEventListener('click', () => {
                    el.classList.remove('show');
                    resolve(i);
                });
                box.appendChild(btn);
            });
            el.appendChild(box);
            el.classList.add('show');
        });
    },

    /* ============================================================
       淡入淡出
       ============================================================ */
    fadeTo(alpha, ms) {
        return new Promise(resolve => {
            this.fadeTarget = alpha;
            if (ms > 0) {
                this.fadeSpeed = Math.abs(this.fadeTarget - this.fadeAlpha) / (ms / 1000);
            } else {
                this.fadeAlpha = alpha;
            }
            this._fadeResolve = resolve;
            if (Math.abs(this.fadeAlpha - this.fadeTarget) < 0.001) {
                this.fadeAlpha = this.fadeTarget;
                this._fadeResolve = null;
                resolve();
            }
        });
    },

    updateFade(dt) {
        if (Math.abs(this.fadeAlpha - this.fadeTarget) < 0.001) {
            this.fadeAlpha = this.fadeTarget;
            if (this._fadeResolve) {
                const r = this._fadeResolve;
                this._fadeResolve = null;
                r();
            }
        } else {
            const dir = this.fadeTarget > this.fadeAlpha ? 1 : -1;
            this.fadeAlpha += dir * this.fadeSpeed * dt;
            this.fadeAlpha = clamp(this.fadeAlpha, 0, 1);
        }
        const c = this.fadeCanvas, g = this.fadeCtx;
        g.clearRect(0, 0, c.width, c.height);
        if (this.fadeAlpha > 0.001) {
            g.fillStyle = `rgba(0,0,0,${this.fadeAlpha})`;
            g.fillRect(0, 0, c.width, c.height);
        }
    },

    /* ============================================================
       兼容旧接口
       ============================================================ */
    setInteractTarget(el) { this._interactTarget = el; },
    getInteractTarget() { return this._interactTarget; },
    onInteractClick(cb) { },
};