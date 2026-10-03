/* 角色实例：4 方向 × 3 帧，站立停中间帧 + 属性 + 装备加成 */

class Character {
    constructor(data, x, y, opts) {
        opts = opts || {};
        this.sprite = data.sprite;
        this.json = data.json;
        this.name = opts.name || '角色';

        this.x = x;
        this.y = y;

        this.direction = opts.direction || 'down';
        this.moving = false;
        this.frameIndex = 1;
        this._timer = 0;
        this.frameDuration = 0.12;
        this.speed = opts.speed || 120;

        this.locked = false;
        this.visible = true;

        this.acceptLight = opts.acceptLight !== false;
        this.acceptLightFrom = opts.acceptLightFrom || ['interaction', 'background', 'element'];
        this.lightLevel = 1.0;

        this.superLight = opts.superLight === true;
        this.canWalk = null;

        const j = data.json || {};
        this.frameWidth = j.frameWidth || 32;
        this.frameHeight = j.frameHeight || 32;
        this.pivot = j.pivot || { x: this.frameWidth / 2, y: this.frameHeight };

        /* ============================================================
           ★ 属性系统
           _baseStats：基础值（不含装备）
           stats：最终值（基础 + 装备加成）
           ============================================================ */
        this._baseStats = {
            hp: 100, hpMax: 100,
            focus: 50, focusMax: 50,
            brain: 10, brainMax: 10,
        };
        this.stats = Object.assign({}, this._baseStats);

        this.inventory = [];        // [{ itemId, count }]
        this.equipment = {
            head: null, body: null, legs: null, feet: null, weapon: null,
        };
        this.gold = 0;
    }

    /* ============ 属性 API ============ */
    getStats() {
        return Object.assign({}, this.stats);
    }

    setStats(partial) {
        if (!partial) return;
        // 同时更新基础值和当前值
        for (const k of Object.keys(partial)) {
            if (typeof partial[k] !== 'number') continue;
            if (k in this._baseStats) this._baseStats[k] = partial[k];
            if (k in this.stats) this.stats[k] = partial[k];
        }
        this._recalcStats();
    }

    /* ★ 重新计算 stats（基础 + 装备加成） */
    _recalcStats() {
        const s = Object.assign({}, this._baseStats);
        const itemBook = (typeof GLOBAL_ITEMS !== 'undefined') ? GLOBAL_ITEMS : {};

        for (const slot of Object.keys(this.equipment)) {
            const itemId = this.equipment[slot];
            if (!itemId) continue;
            const item = itemBook[itemId];
            if (!item || !item.effects) continue;
            if (item.effects.hpMax) s.hpMax += item.effects.hpMax;
            if (item.effects.focusMax) s.focusMax += item.effects.focusMax;
            if (item.effects.brain) {
                // 脑力：同时加当前值和上限
                s.brainMax += item.effects.brain;
                s.brain += item.effects.brain;
            }
        }

        // 当前值夹到新上限
        s.hp = Math.min(this.stats.hp, s.hpMax);
        s.focus = Math.min(this.stats.focus, s.focusMax);
        s.brain = Math.min(this.stats.brain, s.brainMax);

        this.stats = s;
    }

    /* ============ 背包 API ============ */
    addItem(itemId, count) {
        count = count || 1;
        if (count <= 0) return true;
        // 先填满已有的堆
        for (const slot of this.inventory) {
            if (slot.itemId === itemId && slot.count < 64) {
                const can = Math.min(64 - slot.count, count);
                slot.count += can;
                count -= can;
                if (count <= 0) return true;
            }
        }
        // 开新堆
        while (count > 0) {
            const add = Math.min(64, count);
            this.inventory.push({ itemId: itemId, count: add });
            count -= add;
        }
        return true;
    }

    removeItem(itemId, count) {
        count = count || 1;
        if (count <= 0) return true;
        for (let i = this.inventory.length - 1; i >= 0; i--) {
            const slot = this.inventory[i];
            if (slot.itemId !== itemId) continue;
            const take = Math.min(slot.count, count);
            slot.count -= take;
            count -= take;
            if (slot.count <= 0) this.inventory.splice(i, 1);
            if (count <= 0) return true;
        }
        return count <= 0;
    }

    countItem(itemId) {
        let total = 0;
        for (const slot of this.inventory) {
            if (slot.itemId === itemId) total += slot.count;
        }
        return total;
    }

    /* ============ 装备 API ============ */
    equip(slotName, itemId) {
        if (!(slotName in this.equipment)) return false;
        if (!itemId) return false;
        if (this.countItem(itemId) < 1) return false;

        // 卸下当前，放回背包
        if (this.equipment[slotName]) {
            this.addItem(this.equipment[slotName], 1);
        }
        // 从背包扣 1
        this.removeItem(itemId, 1);
        this.equipment[slotName] = itemId;
        this._recalcStats();
        return true;
    }

    unequip(slotName) {
        if (!(slotName in this.equipment)) return false;
        if (!this.equipment[slotName]) return false;
        this.addItem(this.equipment[slotName], 1);
        this.equipment[slotName] = null;
        this._recalcStats();
        return true;
    }

    /* ============ 位移 ============ */
    _dirIndex() {
        return { down: 0, up: 1, left: 2, right: 3 }[this.direction] || 0;
    }

    setDirection(dir) {
        if (['down', 'up', 'left', 'right'].indexOf(dir) >= 0) {
            this.direction = dir;
        }
    }

    setPosition(x, y) { this.x = x; this.y = y; }

    update(dt, input) {
        if (this.locked) {
            this.moving = false;
            this.frameIndex = 1;
            return;
        }

        let vx = 0, vy = 0;
        if (input.left) vx -= 1;
        if (input.right) vx += 1;
        if (input.up) vy -= 1;
        if (input.down) vy += 1;

        if (vx !== 0 || vy !== 0) {
            if (vx !== 0) this.direction = vx > 0 ? 'right' : 'left';
            else if (vy !== 0) this.direction = vy > 0 ? 'down' : 'up';

            const norm = Math.hypot(vx, vy);
            vx /= norm; vy /= norm;

            const dx = vx * this.speed * dt;
            const dy = vy * this.speed * dt;

            if (this.canWalk) {
                const nx = this.x + dx;
                if (this.canWalk(nx, this.y)) this.x = nx;
                const ny = this.y + dy;
                if (this.canWalk(this.x, ny)) this.y = ny;
            } else {
                this.x += dx;
                this.y += dy;
            }

            if (dx === 0 && dy === 0) {
                this.moving = false;
                this.frameIndex = 1;
            } else {
                this.moving = true;
                this._timer += dt;
                while (this._timer >= this.frameDuration) {
                    this._timer -= this.frameDuration;
                    this.frameIndex = (this.frameIndex + 1) % 3;
                }
            }
        } else {
            this.moving = false;
            this.frameIndex = 1;
            this._timer = 0;
        }
    }

    draw(g) {
        if (!this.visible) return;

        const fw = this.frameWidth;
        const fh = this.frameHeight;
        const globalFrame = this._dirIndex() * 3 + this.frameIndex;
        const sx = globalFrame * fw;
        const sy = 0;

        const dx = this.x - this.pivot.x;
        const dy = this.y - this.pivot.y;

        g.drawImage(this.sprite, sx, sy, fw, fh, dx, dy, fw, fh);
    }
}