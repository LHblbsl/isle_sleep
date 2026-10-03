/* ============================================================
   游戏运行时 · 房间 UI 层 v4
   - 新增 interactBtn（交互按钮，跟随附近物体）
   - 新增 statsPanel（属性/背包/装备 面板）
   - 全局物品表 GLOBAL_ITEMS
   ============================================================ */

/* ============================================================
   全局物品表（引擎预置；房间脚本可 ctx.defineItem() 覆盖）
   ============================================================ */
var GLOBAL_ITEMS = {
    potion_small: {
        id: 'potion_small', name: '小药水', type: 'consumable',
        icon: '🧪', desc: '回复 20 点血量', use: { hp: 20 },
    },
    potion_focus: {
        id: 'potion_focus', name: '专注药水', type: 'consumable',
        icon: '💧', desc: '回复 15 点专注', use: { focus: 15 },
    },
    key_old: {
        id: 'key_old', name: '生锈的钥匙', type: 'story',
        icon: '🗝️', desc: '看起来有些年头了。',
    },
    sword_iron: {
        id: 'sword_iron', name: '铁剑', type: 'equipment',
        icon: '⚔️', desc: '普通铁剑', slot: 'weapon',
        effects: { brain: 5 },
    },
    hat_cloth: {
        id: 'hat_cloth', name: '布帽', type: 'equipment',
        icon: '🎩', desc: '一顶旧帽子', slot: 'head',
        effects: { hpMax: 10 },
    },
    shirt_school: {
        id: 'shirt_school', name: '校服上衣', type: 'equipment',
        icon: '👕', desc: '校服。', slot: 'body',
        effects: { hpMax: 15 },
    },
    pants_school: {
        id: 'pants_school', name: '校服裤子', type: 'equipment',
        icon: '👖', desc: '校服。', slot: 'legs',
        effects: { focusMax: 10 },
    },
    shoes_school: {
        id: 'shoes_school', name: '运动鞋', type: 'equipment',
        icon: '👟', desc: '校服配套的鞋。', slot: 'feet',
        effects: { hpMax: 5 },
    },
};

var RoomUI = {
    container: null,
    engine: null,
    elements: new Map(),
    joystickState: { active: false, dx: 0, dy: 0, id: null },
    _joystickLocked: false,
    _initialized: false,
    _running: false,
    _scriptCache: new Map(),
    _effectCanvas: new Map(),
    _measureCtx: null,
    _htmlFrames: new Map(),
    _eventHandlers: {},
    _scale: 1,
    _vpW: 1280,
    _vpH: 720,
    _dw: 1280,
    _dh: 720,

    /* 交互目标状态 */
    _interactTargets: [],       // 附近的 ElementInstance 列表
    _interactIndex: 0,          // 当前选中第几个

    /* 面板状态 */
    _panelOpen: false,

    /* ============ 初始化 ============ */
    init(engine) {
        if (this._initialized) return;
        this.engine = engine;
        this.container = document.getElementById('room-ui-layer');
        var mc = document.createElement('canvas');
        mc.width = 1; mc.height = 1;
        this._measureCtx = mc.getContext('2d');
        this._initialized = true;

        // 滚轮：切换交互目标
        window.addEventListener('wheel', this._onWheel.bind(this), { passive: false });

        // 键盘：I 键开关面板
        window.addEventListener('keydown', function (e) {
            if (e.code === 'KeyI') {
                // 只在 game iframe 里响应
                if (document.hasFocus && !document.hasFocus()) return;
                this._panelOpen = !this._panelOpen;
                this._broadcast('panel:toggle', { open: this._panelOpen });
            }
        }.bind(this));
    },

    _onWheel(e) {
        if (this._interactTargets.length <= 1) return;
        if (this._panelOpen) return;
        e.preventDefault();
        const dir = e.deltaY > 0 ? 1 : -1;
        this._interactIndex =
            (this._interactIndex + dir + this._interactTargets.length) % this._interactTargets.length;
        this._broadcast('interact:changed', {});
    },

    _broadcast(name, data) {
        for (var entry of this.elements.values()) {
            var def = entry.def;
            if (!def.onUpdate) continue;
            // 直接跑一次 onUpdate，让交互元素立即知道状态变了
        }
        // 改为：让交互元素每帧自己读状态，这里不用主动触发
    },

    /* ============ 清空 ============ */
    clear() {
        if (!this.container) return;
        this._running = false;
        this._htmlFrames.clear();
        this._effectCanvas.clear();
        this._scriptCache.clear();
        this._eventHandlers = {};
        this.container.innerHTML = '';
        this.elements.clear();
        this.joystickState.dx = 0;
        this.joystickState.dy = 0;
        this.joystickState.active = false;
        this.joystickState.id = null;
        this._joystickLocked = false;
        this._interactTargets = [];
        this._interactIndex = 0;
        this._panelOpen = false;
    },

    /* ============ 事件总线 ============ */
    onEvent(name, handler) {
        if (!this._eventHandlers[name]) this._eventHandlers[name] = [];
        this._eventHandlers[name].push(handler);
    },
    offEvent(name, handler) {
        var list = this._eventHandlers[name];
        if (!list) return;
        var i = list.indexOf(handler);
        if (i >= 0) list.splice(i, 1);
    },
    fireEvent(name, data) {
        var list = this._eventHandlers[name];
        if (!list || !list.length) return;
        for (var i = 0; i < list.length; i++) {
            try { list[i](data); }
            catch (e) { console.error('[RoomUI] 事件处理失败:', name, e); }
        }
    },

    setJoystickLocked(locked) {
        this._joystickLocked = !!locked;
        if (locked) {
            this.joystickState.dx = 0;
            this.joystickState.dy = 0;
            this.joystickState.active = false;
        }
    },

    /* ============ 交互目标设置（engine 每帧调用） ============ */
    setInteractTargets(list, index) {
        this._interactTargets = list || [];
        if (this._interactIndex >= this._interactTargets.length) {
            this._interactIndex = 0;
        }
        if (index != null && index >= 0 && index < this._interactTargets.length) {
            this._interactIndex = index;
        }
    },

    getInteractTargets() { return this._interactTargets; },
    getInteractIndex() { return this._interactIndex; },

    /* ============ 加载 ============ */
    load(roomUI) {
        this.clear();
        if (!roomUI || !Array.isArray(roomUI.elements)) return;
        for (var i = 0; i < roomUI.elements.length; i++) {
            this._createElement(roomUI.elements[i]);
        }
        this._applyLayout();
        this._running = true;
    },

    resize(vpW, vpH, dw, dh, dx, dy) {
        if (!this.container) return;
        this._vpW = vpW;
        this._vpH = vpH;
        this._dw = dw;
        this._dh = dh;
        var style = this.container.style;
        style.position = 'absolute';
        style.width = dw + 'px';
        style.height = dh + 'px';
        style.left = dx + 'px';
        style.top = dy + 'px';
        this._applyLayout();
    },

    _applyLayout() {
        if (!this.container) return;
        var s = this._dw / this._vpW;
        this._scale = s;
        for (var entry of this.elements.values()) {
            this._layoutElement(entry, s);
        }
    },

    _layoutElement(entry, s) {
        var def = entry.def, dom = entry.dom;
        dom.style.left = (def.x * s) + 'px';
        dom.style.top = (def.y * s) + 'px';
        if (def.type === 'joystick') {
            var sz = def.size || 160;
            dom.style.width = (sz * s) + 'px';
            dom.style.height = (sz * s) + 'px';
        } else {
            if (def.w != null) dom.style.width = (def.w * s) + 'px';
            if (def.h != null) dom.style.height = (def.h * s) + 'px';
        }
        if (def.opacity != null) dom.style.opacity = def.opacity;
        if (def.zIndex != null) dom.style.zIndex = def.zIndex;
        if (def.rotation) dom.style.transform = 'rotate(' + def.rotation + 'deg)';
        else dom.style.transform = '';

        if (def.type === 'effect') {
            var ec = this._effectCanvas.get(def.id);
            if (ec) {
                var nw = Math.max(1, Math.round(def.w || 1280));
                var nh = Math.max(1, Math.round(def.h || 720));
                if (ec.width !== nw || ec.height !== nh) {
                    ec.width = nw;
                    ec.height = nh;
                    if (def._runtime) def._runtime = {};
                }
            }
        }
    },

    /* ============ 创建元素 ============ */
    _createElement(def) {
        if (!def || !def.id) return;
        var el = document.createElement('div');
        el.className = 'ui-el';
        el.dataset.id = def.id;
        el.style.pointerEvents = 'none';
        el.style.boxSizing = 'border-box';

        var entry = { def: def, dom: el };
        this.elements.set(def.id, entry);
        if (!def._runtime) def._runtime = {};

        switch (def.type) {
            case 'joystick': this._buildJoystick(el, def, entry); break;
            case 'circleBtn':
            case 'button': this._buildButton(el, def, entry); break;
            case 'image':
            case 'gif': this._buildImage(el, def, entry); break;
            case 'text': this._buildText(el, def, entry); break;
            case 'panel': this._buildPanel(el, def, entry); break;
            case 'effect': this._buildEffect(el, def, entry); break;
            case 'html': this._buildHtml(el, def, entry); break;
            case 'interactBtn': this._buildInteractBtn(el, def, entry); break;
            case 'statsPanel': this._buildStatsPanel(el, def, entry); break;
        }

        this.container.appendChild(el);

        if (def.onStart) {
            this._runScript(def.onStart, this._makeEnv(def), 'el.onStart');
        }
    },

    /* ============ 摇杆 ============ */
    _buildJoystick(el, def, entry) {
        var self = this;
        el.classList.add('ui-joystick');
        el.style.borderRadius = '50%';
        el.style.background = def.baseColor || 'rgba(42,77,122,0.55)';
        el.style.border = '3px solid ' + (def.stickColor || '#6ec8e0');
        el.style.pointerEvents = 'auto';
        el.style.touchAction = 'none';
        el.style.boxSizing = 'border-box';
        el.style.position = 'absolute';
        el.style.overflow = 'hidden';

        var stick = document.createElement('div');
        stick.style.cssText =
            'position:absolute;left:29%;top:29%;width:42%;height:42%;' +
            'border-radius:50%;background:' + (def.stickColor || '#6ec8e0') + ';' +
            'pointer-events:none;will-change:transform;' +
            'box-shadow: 0 0 12px rgba(110,200,224,0.6);';
        el.appendChild(stick);
        entry.stick = stick;

        var pointerId = null;

        var onDown = function (e) {
            e.preventDefault();
            if (self._joystickLocked) return;
            if (pointerId !== null) return;
            pointerId = e.pointerId;
            try { el.setPointerCapture(pointerId); } catch (err) { }
            self.joystickState.active = true;
            self.joystickState.id = def.id;
            onMove(e);
        };
        var onMove = function (e) {
            if (pointerId === null || e.pointerId !== pointerId) return;
            e.preventDefault();
            if (self._joystickLocked) {
                stick.style.transform = 'translate(0,0)';
                self.joystickState.dx = 0;
                self.joystickState.dy = 0;
                return;
            }
            var rect = el.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var maxR = rect.width * 0.29;
            var dx = e.clientX - cx;
            var dy = e.clientY - cy;
            var len = Math.hypot(dx, dy);
            if (len > maxR) { dx = dx / len * maxR; dy = dy / len * maxR; }
            stick.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
            self.joystickState.dx = dx / maxR;
            self.joystickState.dy = dy / maxR;
        };
        var onUp = function (e) {
            if (pointerId === null || e.pointerId !== pointerId) return;
            try { el.releasePointerCapture(pointerId); } catch (err) { }
            pointerId = null;
            stick.style.transform = 'translate(0,0)';
            self.joystickState.active = false;
            self.joystickState.dx = 0;
            self.joystickState.dy = 0;
            self.joystickState.id = null;
        };
        el.addEventListener('pointerdown', onDown);
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
    },

    /* ============ 普通按钮 ============ */
    _buildButton(el, def, entry) {
        var w = def.w || 100;
        var h = def.h || w;
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.pointerEvents = 'auto';
        el.style.cursor = 'pointer';
        el.style.touchAction = 'manipulation';
        el.style.fontFamily = def.fontFamily || 'sans-serif';
        el.style.fontWeight = 'bold';
        el.style.textAlign = 'center';
        el.style.lineHeight = '1';
        el.style.overflow = 'hidden';
        el.style.whiteSpace = 'nowrap';
        el.style.padding = '0 6px';
        el.style.boxSizing = 'border-box';

        if (def.type === 'circleBtn') el.style.borderRadius = '50%';
        else el.style.borderRadius = (def.borderRadius || 8) + 'px';

        el.style.background = def.bgColor || '#2a4d7a';
        el.style.border = (def.borderWidth || 3) + 'px solid ' + (def.borderColor || '#6ec8e0');
        el.style.color = def.iconColor || def.textColor || '#ffffff';

        el.textContent = def.icon || def.text || '';

        var baseFontSize = def.fontSize != null
            ? def.fontSize
            : Math.round(Math.min(w, h) * 1.2);
        var borderW = (def.borderWidth || 3) * 2;
        var availW = w - borderW - 12;
        var availH = h - borderW - 4;
        var ff = def.fontFamily || 'sans-serif';
        this._measureCtx.font = 'bold ' + baseFontSize + 'px ' + ff;
        var textW = this._measureCtx.measureText(el.textContent).width;
        var finalSize = baseFontSize;
        if (textW > availW && textW > 0) {
            finalSize = Math.max(8, Math.floor(baseFontSize * availW / textW));
        }
        if (finalSize > availH) finalSize = Math.max(8, availH);
        el.style.fontSize = finalSize + 'px';

        this._bindClick(el, def, entry);
    },

    /* ============ 图片 ============ */
    _buildImage(el, def, entry) {
        var img = document.createElement('img');
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.display = 'block';
        img.style.pointerEvents = 'none';
        if (def.src) img.src = def.src;
        el.appendChild(img);
        entry.img = img;
        this._bindClick(el, def, entry);
    },

    /* ============ 文本 ============ */
    _buildText(el, def, entry) {
        el.style.whiteSpace = 'pre-wrap';
        el.style.color = def.color || '#ffffff';
        el.style.fontFamily = def.fontFamily || 'sans-serif';
        el.style.textAlign = def.align || 'left';
        el.style.fontSize = (def.fontSize || 24) + 'px';
        el.style.lineHeight = '1.3';
        if (def.bold) el.style.fontWeight = 'bold';
        el.textContent = def.text || '';
        this._bindClick(el, def, entry);
    },

    /* ============ 面板（canvas 绘制） ============ */
    _buildPanel(el, def, entry) {
        el.style.pointerEvents = 'auto';
        el.style.boxSizing = 'border-box';
        el.style.position = 'absolute';
        el.style.overflow = 'visible';

        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(def.w || 400));
        cv.height = Math.max(1, Math.round(def.h || 200));
        cv.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
        el.appendChild(cv);
        entry.canvas = cv;
        entry.ctx = cv.getContext('2d');
        this._bindClick(el, def, entry);
    },

    /* ============ 特效 ============ */
    _buildEffect(el, def, entry) {
        var ec = document.createElement('canvas');
        ec.width = Math.max(1, Math.round(def.w || 1280));
        ec.height = Math.max(1, Math.round(def.h || 720));
        ec.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
        el.appendChild(ec);
        this._effectCanvas.set(def.id, ec);
        this._bindClick(el, def, entry);
    },

    /* ============ HTML ============ */
    _buildHtml(el, def, entry) {
        var iframe = document.createElement('iframe');
        iframe.style.cssText = 'width:100%;height:100%;border:0;background:transparent;';
        iframe.srcdoc = def.html || '';
        el.appendChild(iframe);
        entry.iframe = iframe;
        this._htmlFrames.set(def.id, iframe);
        if (def.pointerEvents === true) el.style.pointerEvents = 'auto';
    },

    /* ============================================================
       ★ 交互按钮 interactBtn
       ============================================================ */
    _buildInteractBtn(el, def, entry) {
        var self = this;
        el.style.pointerEvents = 'none';
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'flex-end';
        el.style.gap = '10px';
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';

        // 名字条列表容器
        var listEl = document.createElement('div');
        listEl.style.cssText =
            'display:flex;flex-direction:column;align-items:center;gap:6px;' +
            'pointer-events:none;';
        el.appendChild(listEl);
        entry.listEl = listEl;
        entry._itemMap = new Map();       // targetId -> dom

        // 主圆按钮
        var size = def.btnSize || 68;
        var btn = document.createElement('div');
        btn.style.cssText =
            'width:' + size + 'px;height:' + size + 'px;border-radius:50%;' +
            'display:flex;align-items:center;justify-content:center;' +
            'background:' + (def.btnBg || 'rgba(20,30,45,0.85)') + ';' +
            'border:2px solid ' + (def.btnBorder || 'rgba(110,200,224,0.5)') + ';' +
            'color:' + (def.btnColor || '#7ac8e0') + ';' +
            'font-size:' + Math.round(size * 0.45) + 'px;' +
            'cursor:pointer;pointer-events:auto;' +
            'transition:transform 0.12s, background 0.12s, border-color 0.12s;' +
            'user-select:none;flex-shrink:0;';
        btn.textContent = def.btnIcon || '◎';
        btn.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            btn.style.transform = 'scale(0.9)';
        });
        btn.addEventListener('pointerup', function (e) {
            e.preventDefault();
            e.stopPropagation();
            btn.style.transform = '';
            self._fireInteractTarget();
        });
        btn.addEventListener('pointerleave', function () {
            btn.style.transform = '';
        });
        el.appendChild(btn);
        entry.btn = btn;

        entry._shown = false;
    },
    _syncInteractList(entry, targets, activeIdx) {
        var listEl = entry.listEl;
        var map = entry._itemMap;
        var self = this;

        if (!listEl || !map) return;

        var newIds = new Set();
        for (var i = 0; i < targets.length; i++) {
            var target = targets[i];
            var targetId = target.id || ('t_' + i);
            newIds.add(targetId);

            if (!map.has(targetId)) {
                // 新建名字条
                var item = document.createElement('div');
                item.dataset.targetId = targetId;
                item.style.cssText =
                    'padding:6px 16px;border-radius:10px;white-space:nowrap;' +
                    'font-family:system-ui,-apple-system,sans-serif;font-size:14px;' +
                    'letter-spacing:0.5px;' +
                    'background:rgba(15,20,30,0.88);color:#e8e8ea;' +
                    'border:1px solid rgba(110,200,224,0.3);' +
                    'opacity:0;transform:translateY(8px);' +
                    'transition:opacity 0.25s ease, transform 0.25s ease, ' +
                    'background 0.15s, border-color 0.15s;' +
                    'pointer-events:auto;cursor:pointer;user-select:none;';
                item.textContent = target.name || (target.data && target.data.name) || '物体';

                (function (tgt) {
                    item.addEventListener('pointerdown', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        item.style.background = 'rgba(110,200,224,0.18)';
                        item.style.borderColor = 'rgba(110,200,224,0.6)';
                    });
                    item.addEventListener('pointerup', function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        item.style.background = 'rgba(15,20,30,0.88)';
                        item.style.borderColor = 'rgba(110,200,224,0.3)';
                        if (tgt.data && tgt.data.eventId && self.engine) {
                            self.engine._fireEvent(tgt.data.eventId);
                        }
                    });
                    item.addEventListener('pointerleave', function () {
                        item.style.background = 'rgba(15,20,30,0.88)';
                        item.style.borderColor = 'rgba(110,200,224,0.3)';
                    });
                })(target);

                listEl.appendChild(item);
                map.set(targetId, item);

                // 触发淡入
                (function (it) {
                    requestAnimationFrame(function () {
                        requestAnimationFrame(function () {
                            it.style.opacity = '1';
                            it.style.transform = 'translateY(0)';
                        });
                    });
                })(item);
            } else {
                // 更新名字（万一物体名字变了）
                var existing = map.get(targetId);
                var newName = target.name || (target.data && target.data.name) || '物体';
                if (existing.textContent !== newName) {
                    existing.textContent = newName;
                }
            }
        }

        // 移除已经不存在的
        map.forEach(function (item, id) {
            if (!newIds.has(id)) {
                item.style.opacity = '0';
                item.style.transform = 'translateY(8px)';
                setTimeout(function () {
                    if (item.parentNode) item.parentNode.removeChild(item);
                }, 260);
                map.delete(id);
            }
        });

        // 高亮当前选中的
        var activeTarget = targets[activeIdx];
        var activeId = activeTarget ? activeTarget.id : null;
        map.forEach(function (item, id) {
            if (id === activeId) {
                item.style.background = 'rgba(110,200,224,0.18)';
                item.style.borderColor = 'rgba(110,200,224,0.7)';
            } else {
                item.style.background = 'rgba(15,20,30,0.88)';
                item.style.borderColor = 'rgba(110,200,224,0.3)';
            }
        });
    },
    _fireInteractTarget() {
        var targets = this._interactTargets;
        if (!targets || !targets.length) return;
        var idx = this._interactIndex;
        var el = targets[idx];
        if (!el) return;
        if (el.data && el.data.eventId && this.engine) {
            this.engine._fireEvent(el.data.eventId);
        }
    },

    /* ============================================================
       ★ 属性面板 statsPanel
       ============================================================ */
    _buildStatsPanel(el, def, entry) {
        var self = this;
        el.style.pointerEvents = 'none';
        el.style.overflow = 'hidden';
        el.style.borderRadius = (def.borderRadius || 16) + 'px';
        el.style.background = def.bgColor || 'rgba(16,20,28,0.94)';
        el.style.border = (def.borderWidth || 2) + 'px solid ' + (def.borderColor || 'rgba(110,200,224,0.4)');

        // ★ 动画初始状态
        el.style.display = 'none';
        el.style.opacity = '0';
        el.style.transform = 'scale(0.9) translateY(16px)';
        el.style.transformOrigin = 'center center';
        el.style.transition =
            'opacity 0.24s ease, transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1)';
        el.style.willChange = 'opacity, transform';
        entry._visible = false;
        entry._hideTimer = null;

        // header
        var header = document.createElement('div');
        header.style.cssText =
            'display:flex;align-items:center;justify-content:space-between;' +
            'padding:14px 18px 10px;border-bottom:1px solid rgba(110,200,224,0.15);';
        var title = document.createElement('div');
        title.textContent = def.title || '状态';
        title.style.cssText = 'font-size:16px;font-weight:600;color:#e8e8ea;letter-spacing:1px;';
        header.appendChild(title);

        var closeBtn = document.createElement('div');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText =
            'width:26px;height:26px;border-radius:6px;display:flex;' +
            'align-items:center;justify-content:center;cursor:pointer;' +
            'color:#8890a0;font-size:14px;pointer-events:auto;' +
            'transition:background 0.15s,color 0.15s;';
        closeBtn.addEventListener('pointerenter', function () {
            closeBtn.style.background = 'rgba(255,255,255,0.08)';
            closeBtn.style.color = '#fff';
        });
        closeBtn.addEventListener('pointerleave', function () {
            closeBtn.style.background = '';
            closeBtn.style.color = '#8890a0';
        });
        closeBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            self.closeStatsPanel();
        });
        header.appendChild(closeBtn);
        el.appendChild(header);

        // tabs
        var tabs = document.createElement('div');
        tabs.style.cssText =
            'display:flex;gap:4px;padding:8px 14px 0;border-bottom:1px solid rgba(110,200,224,0.1);';
        var tabDefs = [
            { key: 'stats', label: '属性' },
            { key: 'bag', label: '背包' },
            { key: 'equip', label: '装备' },
        ];
        entry.tabs = {};
        entry.activeTab = 'stats';
        tabDefs.forEach(function (t) {
            var tb = document.createElement('div');
            tb.textContent = t.label;
            tb.style.cssText =
                'padding:8px 18px;font-size:13px;color:#8890a0;cursor:pointer;' +
                'border-radius:8px 8px 0 0;pointer-events:auto;' +
                'border:1px solid transparent;border-bottom:0;' +
                'transition:color 0.15s,background 0.15s;';
            tb.addEventListener('click', function (e) {
                e.stopPropagation();
                self._switchStatsTab(entry, t.key);
            });
            tabs.appendChild(tb);
            entry.tabs[t.key] = tb;
        });
        el.appendChild(tabs);

        // content
        var content = document.createElement('div');
        content.style.cssText =
            'padding:14px 18px;overflow-y:auto;max-height:calc(100% - 110px);' +
            'pointer-events:auto;';
        el.appendChild(content);
        entry.content = content;

        this._switchStatsTab(entry, 'stats');
        this._bindClick(el, def, entry);
    },
    /* ★ 面板弹出 */
    _animatePanelShow(entry) {
        var el = entry.dom;
        if (entry._hideTimer) {
            clearTimeout(entry._hideTimer);
            entry._hideTimer = null;
        }

        // 更新内容
        this._renderStatsContent(entry);

        // 先 display，强制回流，再改 opacity/transform
        el.style.display = '';
        void el.offsetWidth;

        el.style.opacity = '1';
        el.style.transform = 'scale(1) translateY(0)';
        entry._visible = true;
    },

    /* ★ 面板收起 */
    _animatePanelHide(entry) {
        var el = entry.dom;
        entry._visible = false;

        el.style.opacity = '0';
        el.style.transform = 'scale(0.9) translateY(16px)';

        if (entry._hideTimer) clearTimeout(entry._hideTimer);
        entry._hideTimer = setTimeout(function () {
            if (!entry._visible) {
                el.style.display = 'none';
            }
            entry._hideTimer = null;
        }, 320);
    },

    _switchStatsTab(entry, key) {
        entry.activeTab = key;
        Object.keys(entry.tabs).forEach(function (k) {
            var tb = entry.tabs[k];
            if (k === key) {
                tb.style.color = '#7ac8e0';
                tb.style.background = 'rgba(110,200,224,0.08)';
                tb.style.borderColor = 'rgba(110,200,224,0.25)';
            } else {
                tb.style.color = '#8890a0';
                tb.style.background = '';
                tb.style.borderColor = 'transparent';
            }
        });

        // ★ 内容淡入
        var c = entry.content;
        if (c) {
            c.style.transition = 'opacity 0.15s ease';
            c.style.opacity = '0';
            var self = this;
            setTimeout(function () {
                self._renderStatsContent(entry);
                c.style.opacity = '1';
            }, 120);
        } else {
            this._renderStatsContent(entry);
        }
    },

    _renderStatsContent(entry) {
        var c = entry.content;
        c.innerHTML = '';
        var player = this.engine ? this.engine.player : null;
        if (!player) {
            c.innerHTML = '<div style="color:#667;text-align:center;padding:30px;">无角色</div>';
            return;
        }

        var self = this;

        /* ★ 图标 HTML（图片优先） */
        function iconHtml(item, size) {
            if (!item) return '<span style="font-size:' + size + 'px;">?</span>';
            if (item.iconImage) {
                var safe = String(item.iconImage).replace(/"/g, '&quot;');
                return '<img src="' + safe + '" style="width:' + size + 'px;height:' + size +
                    'px;object-fit:contain;image-rendering:pixelated;display:block;">';
            }
            return '<span style="font-size:' + Math.round(size * 0.85) + 'px;line-height:1;">' +
                (item.icon || '?') + '</span>';
        }

        if (entry.activeTab === 'stats') {
            var s = player.stats || { hp: 0, hpMax: 0, focus: 0, focusMax: 0, brain: 0, brainMax: 0 };
            c.appendChild(this._makeStatBar('血量', s.hp, s.hpMax, '#e05555', '#ff8080'));
            c.appendChild(this._makeStatBar('专注', s.focus, s.focusMax, '#4a8dd0', '#7ac8e0'));
            c.appendChild(this._makeStatBar('脑力', s.brain, s.brainMax, '#a06ee0', '#c8a0ff'));

            var gold = document.createElement('div');
            gold.style.cssText = 'margin-top:20px;padding:10px 14px;background:rgba(255,204,102,0.08);' +
                'border:1px solid rgba(255,204,102,0.25);border-radius:8px;' +
                'display:flex;justify-content:space-between;align-items:center;';
            gold.innerHTML =
                '<span style="color:#8890a0;font-size:13px;">金币</span>' +
                '<span style="color:#ffcc66;font-size:15px;font-weight:600;">💰 ' + (player.gold || 0) + '</span>';
            c.appendChild(gold);
        }
        else if (entry.activeTab === 'bag') {
            if (!player.inventory || !player.inventory.length) {
                c.innerHTML = '<div style="color:#667;text-align:center;padding:30px;">背包空空如也</div>';
                return;
            }
            var grid = document.createElement('div');
            grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:8px;';
            player.inventory.forEach(function (slot, idx) {
                var item = GLOBAL_ITEMS[slot.itemId];
                var cell = document.createElement('div');
                cell.style.cssText =
                    'position:relative;aspect-ratio:1;background:rgba(255,255,255,0.03);' +
                    'border:1px solid rgba(110,200,224,0.15);border-radius:8px;' +
                    'display:flex;align-items:center;justify-content:center;' +
                    'cursor:pointer;overflow:hidden;' +
                    'transition:background 0.15s,border-color 0.15s;';
                cell.innerHTML = iconHtml(item, 32);
                cell.title = item ? item.name : slot.itemId;
                cell.addEventListener('pointerenter', function () {
                    cell.style.background = 'rgba(110,200,224,0.1)';
                    cell.style.borderColor = 'rgba(110,200,224,0.4)';
                });
                cell.addEventListener('pointerleave', function () {
                    cell.style.background = 'rgba(255,255,255,0.03)';
                    cell.style.borderColor = 'rgba(110,200,224,0.15)';
                });
                cell.addEventListener('click', function (e) {
                    e.stopPropagation();
                    // 如果当前 cell 已经有 tooltip，点击时关闭（toggle 效果）
                    var existing = document.querySelector('.rui-item-tooltip');
                    if (existing && existing._forCell === cell) {
                        self._closeAllTooltips();
                        return;
                    }
                    self._showItemTooltip(entry, idx, cell);
                    var newTip = document.querySelector('.rui-item-tooltip');
                    if (newTip) newTip._forCell = cell;
                });
                if (slot.count > 1) {
                    var cnt = document.createElement('div');
                    cnt.textContent = '×' + slot.count;
                    cnt.style.cssText =
                        'position:absolute;right:3px;bottom:2px;' +
                        'font-size:10px;color:#e8e8ea;' +
                        'background:rgba(0,0,0,0.6);padding:1px 4px;border-radius:3px;';
                    cell.appendChild(cnt);
                }
                grid.appendChild(cell);
            });
            c.appendChild(grid);
        }
        else if (entry.activeTab === 'equip') {
            var slots = [
                { key: 'head', label: '头部', icon: '🎩' },
                { key: 'body', label: '上身', icon: '👕' },
                { key: 'legs', label: '腿部', icon: '👖' },
                { key: 'feet', label: '鞋子', icon: '👟' },
                { key: 'weapon', label: '武器', icon: '⚔️' },
            ];
            var list = document.createElement('div');
            list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
            slots.forEach(function (slot) {
                var itemId = player.equipment && player.equipment[slot.key];
                var item = itemId ? GLOBAL_ITEMS[itemId] : null;
                var row = document.createElement('div');
                row.style.cssText =
                    'display:flex;align-items:center;gap:12px;' +
                    'padding:10px 14px;background:rgba(255,255,255,0.03);' +
                    'border:1px solid rgba(110,200,224,0.12);border-radius:10px;';

                var iconWrap = document.createElement('div');
                iconWrap.style.cssText =
                    'width:32px;height:32px;display:flex;align-items:center;' +
                    'justify-content:center;flex-shrink:0;';
                if (item) {
                    iconWrap.innerHTML = iconHtml(item, 28);
                } else {
                    iconWrap.innerHTML = '<span style="font-size:20px;opacity:0.4;">' + slot.icon + '</span>';
                }
                row.appendChild(iconWrap);

                var infoWrap = document.createElement('div');
                infoWrap.style.cssText = 'flex:1;min-width:0;';
                infoWrap.innerHTML =
                    '<div style="font-size:12px;color:#8890a0;">' + slot.label + '</div>' +
                    '<div style="font-size:14px;color:' + (item ? '#e8e8ea' : '#556') + ';margin-top:2px;">' +
                    (item ? item.name : '（空）') + '</div>';
                row.appendChild(infoWrap);

                if (item) {
                    var offBtn = document.createElement('div');
                    offBtn.textContent = '卸下';
                    offBtn.style.cssText =
                        'padding:5px 12px;background:rgba(255,255,255,0.05);' +
                        'border:1px solid rgba(110,200,224,0.2);border-radius:6px;' +
                        'font-size:12px;color:#8890a0;cursor:pointer;pointer-events:auto;';
                    offBtn.addEventListener('click', function (e) {
                        e.stopPropagation();
                        player.unequip(slot.key);
                        self._renderStatsContent(entry);
                    });
                    row.appendChild(offBtn);
                }
                list.appendChild(row);
            });
            c.appendChild(list);
        }
    },

    _makeStatBar(label, cur, max, colorA, colorB) {
        var wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:16px;';
        var head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:6px;';
        head.innerHTML =
            '<span style="color:#8890a0;font-size:13px;">' + label + '</span>' +
            '<span style="color:#e8e8ea;font-size:13px;font-family:monospace;">' +
            cur + ' / ' + max + '</span>';
        wrap.appendChild(head);
        var bar = document.createElement('div');
        bar.style.cssText =
            'height:10px;background:rgba(255,255,255,0.05);border-radius:5px;overflow:hidden;';
        var fill = document.createElement('div');
        var pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
        fill.style.cssText =
            'height:100%;width:' + (pct * 100) + '%;' +
            'background:linear-gradient(90deg,' + colorA + ',' + colorB + ');' +
            'border-radius:5px;transition:width 0.3s ease;';
        bar.appendChild(fill);
        wrap.appendChild(bar);
        return wrap;
    },

    _showItemTooltip(entry, idx, cell) {
        var player = this.engine ? this.engine.player : null;
        if (!player) return;
        var slot = player.inventory[idx];
        if (!slot) return;
        var item = GLOBAL_ITEMS[slot.itemId];
        if (!item) return;

        // ★ 先关掉所有现有 tooltip
        this._closeAllTooltips();

        var self = this;
        var tip = document.createElement('div');
        tip.className = 'rui-item-tooltip';
        tip.style.cssText =
            'position:fixed;padding:12px 16px;background:rgba(10,14,22,0.96);' +
            'border:1px solid rgba(110,200,224,0.3);border-radius:10px;' +
            'color:#e8e8ea;font-size:13px;z-index:99999;pointer-events:auto;' +
            'max-width:260px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,0.6);';

        var typeLabel = { consumable: '消耗品', equipment: '装备', story: '剧情物品', material: '材料' }[item.type] || '';

        // 头部
        var head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';

        var iconWrap = document.createElement('div');
        iconWrap.style.cssText =
            'width:36px;height:36px;display:flex;align-items:center;' +
            'justify-content:center;flex-shrink:0;';
        if (item.iconImage) {
            iconWrap.innerHTML = '<img src="' + String(item.iconImage).replace(/"/g, '&quot;') +
                '" style="width:36px;height:36px;object-fit:contain;image-rendering:pixelated;border-radius:4px;">';
        } else {
            iconWrap.innerHTML = '<span style="font-size:28px;line-height:1;">' + (item.icon || '?') + '</span>';
        }
        head.appendChild(iconWrap);

        var nameWrap = document.createElement('div');
        nameWrap.innerHTML =
            '<div style="font-size:15px;font-weight:600;">' + (item.name || item.id) + '</div>' +
            '<div style="color:#8890a0;font-size:11px;margin-top:2px;">' + typeLabel + '</div>';
        head.appendChild(nameWrap);
        tip.appendChild(head);

        if (item.desc) {
            var descEl = document.createElement('div');
            descEl.style.cssText = 'color:#c8c8d0;margin-bottom:4px;';
            descEl.textContent = item.desc;
            tip.appendChild(descEl);
        }

        /* 装备 */
        if (item.type === 'equipment' && item.effects) {
            var effHtml = '<div style="margin-top:8px;color:#7ac8e0;font-size:12px;">';
            if (item.effects.hpMax) effHtml += '血量上限 +' + item.effects.hpMax + '<br>';
            if (item.effects.focusMax) effHtml += '专注上限 +' + item.effects.focusMax + '<br>';
            if (item.effects.brain) effHtml += '脑力 +' + item.effects.brain + '<br>';
            effHtml += '</div>';
            tip.innerHTML += effHtml;

            var eqBtn = document.createElement('div');
            eqBtn.textContent = '装备';
            eqBtn.style.cssText =
                'margin-top:10px;padding:6px 0;text-align:center;' +
                'background:rgba(110,200,224,0.15);border:1px solid rgba(110,200,224,0.35);' +
                'border-radius:6px;cursor:pointer;font-size:12px;color:#7ac8e0;';
            eqBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                player.equip(item.slot, item.id);
                self._closeAllTooltips();
                self._renderStatsContent(entry);
            });
            tip.appendChild(eqBtn);
        }

        /* 消耗品 */
        if (item.type === 'consumable' && item.use) {
            var useBtn = document.createElement('div');
            useBtn.textContent = '使用';
            useBtn.style.cssText =
                'margin-top:10px;padding:6px 0;text-align:center;' +
                'background:rgba(110,224,140,0.15);border:1px solid rgba(110,224,140,0.35);' +
                'border-radius:6px;cursor:pointer;font-size:12px;color:#7ae090;';
            useBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (item.use.hp) player.stats.hp = Math.min(player.stats.hpMax, player.stats.hp + item.use.hp);
                if (item.use.focus) player.stats.focus = Math.min(player.stats.focusMax, player.stats.focus + item.use.focus);
                if (item.use.brain) player.stats.brain = Math.min(player.stats.brainMax, player.stats.brain + item.use.brain);
                player.removeItem(item.id, 1);
                self._closeAllTooltips();
                self._renderStatsContent(entry);
            });
            tip.appendChild(useBtn);
        }

        var rect = cell.getBoundingClientRect();
        tip.style.left = Math.min(window.innerWidth - 280, rect.right + 8) + 'px';
        tip.style.top = Math.max(8, rect.top - 20) + 'px';
        document.body.appendChild(tip);

        // ★ 用捕获阶段监听，避免被 stopPropagation 拦掉
        // ★ 但要跳过"点 tooltip 自己"和"点这个 cell"
        var onDocPointerDown = function (e) {
            if (tip.contains(e.target)) return;
            if (e.target === cell) return;      // 同一格再点 → 不关（要留给 cell 的 click）
            self._closeAllTooltips();
        };
        var onDocKeyDown = function (e) {
            if (e.code === 'Escape') self._closeAllTooltips();
        };

        // capture: true 保证在捕获阶段就能收到（target 阶段 stopPropagation 影响不到）
        setTimeout(function () {
            document.addEventListener('pointerdown', onDocPointerDown, true);
            document.addEventListener('keydown', onDocKeyDown, true);
        }, 0);

        // 记录关闭函数
        tip._closeHandler = function () {
            document.removeEventListener('pointerdown', onDocPointerDown, true);
            document.removeEventListener('keydown', onDocKeyDown, true);
            if (tip.parentNode) tip.parentNode.removeChild(tip);
        };
    },
    /* ★ 关闭所有物品 tooltip */
    _closeAllTooltips() {
        var list = document.querySelectorAll('.rui-item-tooltip');
        for (var i = 0; i < list.length; i++) {
            var t = list[i];
            if (t._closeHandler) t._closeHandler();
            else if (t.parentNode) t.parentNode.removeChild(t);
        }
    },
    openStatsPanel() {
        this._panelOpen = true;
        for (var entry of this.elements.values()) {
            if (entry.def.type === 'statsPanel') {
                entry.def.visible = true;
                this._animatePanelShow(entry);
            }
        }
    },
    /* ★ 打开面板并切到指定标签（'stats' / 'bag' / 'equip'） */
    /* 打开面板并切到指定标签（'stats' / 'bag' / 'equip'） */
    openStatsPanelTab(tabKey) {
        this._panelOpen = true;
        for (var entry of this.elements.values()) {
            if (entry.def.type !== 'statsPanel') continue;
            entry.def.visible = true;

            // ★ 如果面板本来就是开的，不重播弹出动画，只切标签
            if (entry._visible) {
                if (tabKey && entry.tabs && entry.tabs[tabKey]) {
                    this._switchStatsTab(entry, tabKey);
                } else {
                    this._renderStatsContent(entry);
                }
            } else {
                this._animatePanelShow(entry);
                if (tabKey && entry.tabs && entry.tabs[tabKey]) {
                    this._switchStatsTab(entry, tabKey);
                }
            }
        }
    },
    closeStatsPanel() {
        this._panelOpen = false;
        for (var entry of this.elements.values()) {
            if (entry.def.type === 'statsPanel') {
                this._animatePanelHide(entry);
            }
        }
    },

    /* ============ 点击绑定 ============ */
    _bindClick(el, def, entry) {
        var self = this;
        el.style.pointerEvents = 'auto';
        el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        el.addEventListener('pointerup', function (e) {
            e.stopPropagation();
            self._fireClick(def, entry);
        });
    },

    _fireClick(def, entry) {
        if (def.onClick) {
            this._runScript(def.onClick, this._makeEnv(def), 'el.onClick');
        }
        if (def.eventId && this.engine) this.engine._fireEvent(def.eventId);
        if (def.toggleTarget) {
            var t = this.elements.get(def.toggleTarget);
            if (t) t.dom.style.display = (t.dom.style.display === 'none') ? '' : 'none';
        }
    },

    /* ============ 每帧 ============ */
    update(dt) {
        if (!this._running) return;

        // 1. 跑 onUpdate
        for (var entry of this.elements.values()) {
            var def = entry.def;
            if (!def.onUpdate) continue;
            var env = this._makeEnv(def);
            env.dt = dt;
            this._runScript(def.onUpdate, env, 'el.onUpdate');
        }

        // 2. 同步 DOM
        var s = this._scale;
        for (var entry2 of this.elements.values()) {
            var def2 = entry2.def;
            var dom = entry2.dom;
            dom.style.left = (def2.x * s) + 'px';
            dom.style.top = (def2.y * s) + 'px';
            if (def2.type === 'joystick') {
                var sz = def2.size || 160;
                dom.style.width = (sz * s) + 'px';
                dom.style.height = (sz * s) + 'px';
            } else {
                if (def2.w != null) dom.style.width = (def2.w * s) + 'px';
                if (def2.h != null) dom.style.height = (def2.h * s) + 'px';
            }
            if (def2.opacity != null) dom.style.opacity = def2.opacity;
            if (def2.zIndex != null) dom.style.zIndex = def2.zIndex;

            if (def2.visible === false) dom.style.display = 'none';
            else if (def2.visible === true && def2.type !== 'statsPanel') dom.style.display = '';

            dom.style.transform = def2.rotation ? ('rotate(' + def2.rotation + 'deg)') : '';
        }

        // 3. 交互按钮状态
        this._updateInteractBtns();

        // 4. panel
        for (var entry3 of this.elements.values()) {
            var def3 = entry3.def;
            if (def3.type === 'panel' && entry3.canvas && entry3.ctx) {
                var nw3 = Math.max(1, Math.round(def3.w || 400));
                var nh3 = Math.max(1, Math.round(def3.h || 200));
                if (entry3.canvas.width !== nw3 || entry3.canvas.height !== nh3) {
                    entry3.canvas.width = nw3;
                    entry3.canvas.height = nh3;
                }
                this._drawPanel(def3, entry3.canvas, entry3.ctx);
            }
        }
    },

    _updateInteractBtns() {
        var targets = this._interactTargets;
        var idx = this._interactIndex;
        var current = targets[idx] || null;

        for (var entry of this.elements.values()) {
            var def = entry.def;
            if (def.type !== 'interactBtn') continue;
            var el = entry.dom;

            // enabled === false 强制隐藏
            if (def._runtime && def._runtime.enabled === false) {
                if (entry._shown) {
                    entry._shown = false;
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(8px)';
                }
                continue;
            }

            if (current && !this._panelOpen) {
                // 显示
                if (!entry._shown) {
                    entry._shown = true;
                    def.visible = true;
                    el.style.display = '';
                    el.style.opacity = '1';
                    el.style.transform = 'translateY(0)';
                }
                // 同步名字条列表
                this._syncInteractList(entry, targets, idx);
            } else {
                // 隐藏
                if (entry._shown) {
                    entry._shown = false;
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(8px)';
                }
            }
        }
    },

    /* ============ 面板绘制 ============ */
    _drawPanel(def, cv, ctx) {
        var w = cv.width;
        var h = cv.height;
        if (w <= 0 || h <= 0) return;
        ctx.clearRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = false;

        function roundRectPath(g, x, y, ww, hh, r) {
            r = Math.max(0, Math.min(r || 0, ww / 2, hh / 2));
            g.beginPath();
            g.moveTo(x + r, y);
            g.arcTo(x + ww, y, x + ww, y + hh, r);
            g.arcTo(x + ww, y + hh, x, y + hh, r);
            g.arcTo(x, y + hh, x, y, r);
            g.arcTo(x, y, x + ww, y, r);
            g.closePath();
        }

        var bw = def.borderWidth != null ? def.borderWidth : 4;
        var r = Math.max(0, def.borderRadius != null ? def.borderRadius : 16);
        var bgColor = def.bgColor || '#141c2a';
        var borderColor = def.borderColor || '#6ec8e0';

        roundRectPath(ctx, 0, 0, w, h, r);
        ctx.fillStyle = borderColor;
        ctx.fill();
        var innerR = Math.max(0, r - bw * 0.5);
        roundRectPath(ctx, bw, bw, w - bw * 2, h - bw * 2, innerR);
        ctx.fillStyle = bgColor;
        ctx.fill();

        ctx.save();
        roundRectPath(ctx, bw, bw, w - bw * 2, h - bw * 2, innerR);
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(bw, bw, w - bw * 2, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(bw, h - bw - 2, w - bw * 2, 2);
        ctx.restore();

        var titleSpace = 0;
        if (def.title) {
            titleSpace = 24;
            ctx.fillStyle = def.titleColor || borderColor;
            ctx.font = 'bold 16px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(def.title, bw + 12, bw + 8);
        }
        if (def.text) {
            var full = String(def.text);
            var prog = def.textProgress;
            if (prog == null || !isFinite(prog)) prog = full.length;
            var shown = full.slice(0, Math.max(0, Math.floor(prog)));
            if (shown) {
                var fs = def.textFontSize || 22;
                ctx.fillStyle = def.textColor || '#e8e8ea';
                ctx.font = fs + 'px ' + (def.textFontFamily || 'sans-serif');
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                var hintShift = def.showHint ? 14 : 0;
                var lines = shown.split('\n');
                var lineH = fs * 1.5;
                var totalH = lines.length * lineH;
                var areaTop = bw + titleSpace;
                var areaH = h - bw * 2 - titleSpace;
                var startY = areaTop + areaH / 2 - hintShift - totalH / 2 + lineH / 2;
                for (var i = 0; i < lines.length; i++) {
                    ctx.fillText(lines[i], w / 2, startY + i * lineH);
                }
            }
        }
        if (def.showHint && def.hintText) {
            ctx.save();
            var blink = 0.5 + 0.5 * Math.sin(performance.now() / 400);
            ctx.globalAlpha *= blink;
            ctx.fillStyle = def.hintColor || '#7ac8e0';
            ctx.font = (def.hintFontSize || 14) + 'px ' + (def.textFontFamily || 'sans-serif');
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(def.hintText, w / 2, h - bw - 8);
            ctx.restore();
        }
    },

    /* ============ 环境 ============ */
    _makeEnv(def) {
        var self = this;
        if (!def._runtime) def._runtime = {};
        var extras = {
            dt: 0.016,
            log: console.log,
            ctx2d: self._measureCtx,
            measureText: function (text, fs, ff) {
                self._measureCtx.font = (fs || 16) + 'px ' + (ff || 'sans-serif');
                return self._measureCtx.measureText(String(text)).width;
            },
            isEditor: false,
            stageW: self._vpW,
            stageH: self._vpH,
            state: def._runtime,
            engine: self.engine,
            player: self.engine ? self.engine.player : null,
            getInteractTargets: function () { return self._interactTargets; },
            getInteractIndex: function () { return self._interactIndex; },
            openStatsPanel: function () { self.openStatsPanel(); },
            closeStatsPanel: function () { self.closeStatsPanel(); },
            items: GLOBAL_ITEMS,
        };
        if (def.type === 'effect') {
            var ec = self._effectCanvas.get(def.id);
            extras.canvas = ec;
            extras.ctx2d = ec ? ec.getContext('2d') : self._measureCtx;
        }
        if (def.type === 'html') {
            var iframe = self._htmlFrames.get(def.id);
            extras.iframe = iframe || null;
            extras.window = iframe ? iframe.contentWindow : null;
            extras.document = iframe ? iframe.contentDocument : null;
            extras.post = function (msg) {
                if (iframe) { try { iframe.contentWindow.postMessage(msg, '*'); } catch (e) { } }
            };
        }
        return new Proxy(extras, {
            get: function (t, k) { if (k in t) return t[k]; return def[k]; },
            set: function (t, k, v) { if (k in t) { t[k] = v; return true; } def[k] = v; return true; },
            has: function (t, k) { return (k in t) || (k in def); },
        });
    },

    _runScript(code, env, tag) {
        if (!code || !code.trim()) return;
        try {
            var fn = this._scriptCache.get(code);
            if (!fn) {
                fn = new Function('self', 'dt', code);
                this._scriptCache.set(code, fn);
            }
            fn(env, env.dt || 0.016);
        } catch (e) {
            console.error('[' + tag + ']', e);
        }
    },

    getJoystickVector() {
        if (this._joystickLocked) return { dx: 0, dy: 0 };
        return { dx: this.joystickState.dx, dy: this.joystickState.dy };
    },
    setVisible(id, visible) {
        var entry = this.elements.get(id);
        if (!entry) return;
        entry.def.visible = visible !== false;
        entry.dom.style.display = visible === false ? 'none' : '';
    },
    setVisibleAll(visible) {
        for (var entry of this.elements.values()) {
            this.setVisible(entry.def.id, visible);
        }
    },
    getElement(id) {
        var entry = this.elements.get(id);
        return entry ? entry.def : null;
    },
    /* ★ 从剧情包注入物品表（每次加载新房间前调用） */
    setItems(items) {
        if (!this._baseItems) {
            this._baseItems = JSON.parse(JSON.stringify(GLOBAL_ITEMS));
        }
        // 恢复基线
        for (var k in GLOBAL_ITEMS) delete GLOBAL_ITEMS[k];
        for (var k2 in this._baseItems) {
            GLOBAL_ITEMS[k2] = JSON.parse(JSON.stringify(this._baseItems[k2]));
        }
        // 覆盖传入的
        if (items && typeof items === 'object') {
            for (var id in items) {
                if (Object.prototype.hasOwnProperty.call(items, id)) {
                    GLOBAL_ITEMS[id] = items[id];
                }
            }
        }
        console.log('[RoomUI] 物品表已更新（共 ' + Object.keys(GLOBAL_ITEMS).length + ' 项）');
    },

};

/* ============================================================
   ★ 开发模式：一键清空存档
   - 在 game iframe Console 里运行：devClearSave()
   - 或从 story 页面运行：
     document.getElementById('iframe-game').contentWindow.devClearSave()
   ============================================================ */
function devClearSave() {
    const e = window.__engine;
    if (!e) { console.warn('[DEV] 引擎未初始化'); return; }

    // 清 flags（含 beefli_count / got_homekey 等）
    e.flags = {};

    // 清玩家数据
    if (e.player) {
        e.player.inventory = [];
        e.player.gold = 0;
        e.player.equipment = {
            head: null, body: null, legs: null, feet: null, weapon: null,
        };
        e.player._baseStats = {
            hp: 100, hpMax: 100,
            focus: 50, focusMax: 50,
            brain: 10, brainMax: 10,
        };
        e.player.stats = Object.assign({}, e.player._baseStats);
    }

    console.log('[DEV] 存档已清空（flags + 背包 + 装备 + 属性）');
}
window.devClearSave = devClearSave;