/* ctx：给脚本用的 API（含物品 / 条件对话） */

class Context {
    constructor(engine) {
        this.engine = engine;
    }

    setFlag(k, v) { this.engine.flags[k] = v; }
    getFlag(k) { return this.engine.flags[k]; }

    dialogue(text, name, opts) { return UI.showDialogue(text, name, opts); }

    /* ============================================================
       ★ 对话选项（支持条件过滤）
       两种写法：
         1) await ctx.choice(['开门', '离开'])
         2) await ctx.choice([
              { text: '用钥匙开门', if: () => ctx.hasItem('key_old') },
              { text: '砸门',       if: () => ctx.getStats().brain >= 20 },
              { text: '先离开' },
            ])
       返回值：原始 options 的索引（-1 = 无可用选项）
       ============================================================ */
    async choice(options) {
        if (!options || !options.length) return -1;

        const isObj = typeof options[0] === 'object' && options[0] !== null;
        if (!isObj) {
            return UI.showChoice(options);
        }

        const ctx = this;
        const filtered = [];
        const sourceIndexes = [];

        options.forEach(function (opt, i) {
            if (opt.if) {
                let ok = false;
                try { ok = !!opt.if(); } catch (e) { ok = false; }
                if (!ok) return;
            }
            filtered.push(opt.text != null ? opt.text : String(opt));
            sourceIndexes.push(i);
        });

        if (filtered.length === 0) return -1;

        const picked = await UI.showChoice(filtered);
        return sourceIndexes[picked];
    }

    wait(ms) { return new Promise(r => setTimeout(r, ms)); }
    log(msg) { console.log('[script]', msg); }

    fadeIn(ms) { return UI.fadeTo(0, ms || 800); }
    fadeOut(ms) { return UI.fadeTo(1, ms || 800); }

    /* ---------- 视口 ---------- */
    setViewport(w, h) {
        if (this.engine.room) this.engine.room.viewport = { w, h };
        this.engine._resize();
    }
    getViewport() {
        return this.engine.room ? this.engine.room.viewport : { w: 1280, h: 720 };
    }

    /* ---------- 相机 ---------- */
    get camera() {
        const cam = this.engine.camera;
        return {
            setZoom(z) { cam.setZoom(z); },
            getZoom() { return cam.zoom; },
            setPosition(x, y) { cam.setPosition(x, y); },
            getPosition() { return { x: cam.x, y: cam.y }; },
            moveTo(x, y, ms) { return cam.moveTo(x, y, ms); },
            follow(target) { cam.follow(target); },
            stopFollow() { cam.stopFollow(); },
            shake(intensity, ms) { cam.shake(intensity, ms); },
        };
    }

    /* ---------- 玩家 ---------- */
    get player() {
        const ctx = this;
        return {
            lock() { const p = ctx.engine.getPlayer(); if (p) p.locked = true; },
            unlock() { const p = ctx.engine.getPlayer(); if (p) p.locked = false; },
            setPosition(x, y) { const p = ctx.engine.getPlayer(); if (p) p.setPosition(x, y); },
            setDirection(d) { const p = ctx.engine.getPlayer(); if (p) p.setDirection(d); },
            getPosition() { const p = ctx.engine.getPlayer(); return p ? { x: p.x, y: p.y } : null; },
        };
    }

    getPlayer() { return this.engine.getPlayer(); }

    /* ---------- 场景 ---------- */
    getRoom() { return this.engine.room; }
    async teleport(roomId, x, y) { return this.engine.switchRoom(roomId, x, y); }

    /* ---------- 元素 ---------- */
    getElement(id) { return this.engine.elements.get(id) || null; }
    getElementByName(name) {
        for (const el of this.engine.elements.values()) {
            if (el.name === name) return el;
        }
        return null;
    }
    getAllElements() { return [...this.engine.elements.values()]; }

    playFrames(el, frameList, msPerFrame) {
        if (!el) return Promise.resolve();
        const dur = msPerFrame || 100;
        return new Promise(resolve => {
            let i = 0;
            el.setFrame(frameList[0]);
            if (frameList.length === 1) { resolve(); return; }
            const step = () => {
                i++;
                if (i >= frameList.length) { resolve(); return; }
                el.setFrame(frameList[i]);
                setTimeout(step, dur);
            };
            setTimeout(step, dur);
        });
    }

    animateLight(light, props, ms) {
        if (!light) return Promise.resolve();
        const dur = ms || 300;
        const t0 = performance.now();
        const from = {
            radius: light.radius,
            intensity: light.intensity,
        };
        const to = {
            radius: props.radius != null ? props.radius : from.radius,
            intensity: props.intensity != null ? props.intensity : from.intensity,
        };
        return new Promise(resolve => {
            const tick = () => {
                const t = Math.min(1, (performance.now() - t0) / dur);
                const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                light.radius = lerp(from.radius, to.radius, e);
                light.intensity = lerp(from.intensity, to.intensity, e);
                if (t < 1) requestAnimationFrame(tick);
                else resolve();
            };
            tick();
        });
    }

    /* ---------- 角色 ---------- */
    async spawnCharacter(charId, x, y, opts) {
        return this.engine.spawnCharacter(charId, x, y, opts);
    }
    removeCharacter(instance) { this.engine.removeCharacter(instance); }

    /* ============================================================
       ★ 物品 / 属性 API
       ============================================================ */
    defineItem(item) {
        if (!item || !item.id) return;
        if (typeof GLOBAL_ITEMS !== 'undefined') {
            GLOBAL_ITEMS[item.id] = item;
        }
    }

    /* 给物品 */
    giveItem(itemId, count) {
        const p = this.engine.getPlayer();
        if (!p) return;
        count = count || 1;
        p.addItem(itemId, count);
        if (typeof RoomUI !== 'undefined' && RoomUI.fireEvent) {
            RoomUI.fireEvent('item:gain', { itemId: itemId, count: count });
        }
    }

    /* 硬扣物品（不够就扣到 0） */
    removeItem(itemId, count) {
        const p = this.engine.getPlayer();
        if (!p) return;
        p.removeItem(itemId, count || 1);
    }

    /* 数物品 */
    countItem(itemId) {
        const p = this.engine.getPlayer();
        return p ? p.countItem(itemId) : 0;
    }

    /* ★ 是否持有（至少 count 个） */
    hasItem(itemId, count) {
        const p = this.engine.getPlayer();
        if (!p) return false;
        return p.countItem(itemId) >= (count || 1);
    }

    /* ★ 批量检查：[{id:'a', count:2}, {id:'b'}] */
    hasItems(list) {
        const p = this.engine.getPlayer();
        if (!p || !list) return false;
        for (const req of list) {
            if (p.countItem(req.id) < (req.count || 1)) return false;
        }
        return true;
    }

    /* ★ 消耗物品（不够就返回 false，不扣） */
    consumeItem(itemId, count) {
        const p = this.engine.getPlayer();
        if (!p) return false;
        count = count || 1;
        if (p.countItem(itemId) < count) return false;
        p.removeItem(itemId, count);
        return true;
    }

    /* 设置属性（同时更新基础值） */
    setStats(partial) {
        const p = this.engine.getPlayer();
        if (!p) return;
        p.setStats(partial);
    }

    getStats() {
        const p = this.engine.getPlayer();
        return p ? p.getStats() : null;
    }

    /* ★ 装备 / 卸装 */
    equipItem(slotName, itemId) {
        const p = this.engine.getPlayer();
        if (!p) return false;
        return p.equip(slotName, itemId);
    }
    unequipItem(slotName) {
        const p = this.engine.getPlayer();
        if (!p) return false;
        return p.unequip(slotName);
    }
    getEquipment() {
        const p = this.engine.getPlayer();
        return p ? Object.assign({}, p.equipment) : null;
    }

    /* 金币 */
    addGold(n) {
        const p = this.engine.getPlayer();
        if (!p) return;
        p.gold = Math.max(0, (p.gold || 0) + (n || 0));
    }
    getGold() {
        const p = this.engine.getPlayer();
        return p ? (p.gold || 0) : 0;
    }
    spendGold(n) {
        const p = this.engine.getPlayer();
        if (!p) return false;
        n = n || 0;
        if ((p.gold || 0) < n) return false;
        p.gold -= n;
        return true;
    }

    /* ---------- 音频 ---------- */
    playBGM(id) { console.log('[BGM]', id); }
    stopBGM() { }
    playSound(id) { console.log('[SFX]', id); }
}