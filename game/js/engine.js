/* 主引擎 */

class Engine {
    constructor(canvas) {
        this.canvas = canvas;
        this.g = canvas.getContext('2d');
        this.ctx = new Context(this);

        this.room = null;
        this.assets = {};
        this.elementAssets = {};
        this.characters = {};
        this.characterScripts = {};
        this.events = {};
        this.roomScript = null;

        this.elements = new Map();
        this.actors = [];
        this.player = null;

        this.flags = {};

        this.lightCanvas = null;
        this._lastLightSnap = '';
        this._lightCtx = null;
        this._lightCanvasByGroup = {};
        this._lightCtxByGroup = {};
        this._ambient = 0;

        this._walkables = [];
        this._nowalkables = [];
        this._reflections = [];

        this._actorObstacleCache = new Map();

        this.camera = new Camera(1280, 720, 512, 512);

        Input.init();
        UI.init();
        RoomUI.init(this);

        this.running = false;
        this._lastT = 0;
        this._firedEvents = new Set();

        this.interactRadius = 90;
        this._interactTargets = [];
        this._interactIndex = 0;

        UI.onInteractClick((el) => {
            if (el && el.data.eventId) this._fireEvent(el.data.eventId);
        });

        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyE') {
                const target = UI.getInteractTarget();
                if (target && target.data.eventId) this._fireEvent(target.data.eventId);
            }
        });

        window.addEventListener('resize', () => this._resize());
        this._resize();
    }

    _groupZ(group) {
        const g = (this.room && this.room.groupZ) || {};
        if (typeof g[group] === 'number') return g[group];
        if (group === 'background') return -2000;
        if (group === 'element') return 2000;
        if (group === 'character') return 100;
        return 0;
    }

    _layerZ(group, layer) {
        const base = this._groupZ(group);
        const lz = (typeof layer.zIndex === 'number') ? layer.zIndex : 0;
        return base + lz;
    }

    _resize() {
        const room = this.room;
        const vp = (room && room.viewport) || { w: 1280, h: 720 };

        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const scale = Math.min(winW / vp.w, winH / vp.h);

        const dw = Math.floor(vp.w * scale);
        const dh = Math.floor(vp.h * scale);
        const dx = Math.floor((winW - dw) / 2);
        const dy = Math.floor((winH - dh) / 2);

        this.canvas.width = vp.w;
        this.canvas.height = vp.h;

        const style = this.canvas.style;
        style.position = 'absolute';
        style.width = dw + 'px';
        style.height = dh + 'px';
        style.left = dx + 'px';
        style.top = dy + 'px';
        style.imageRendering = 'pixelated';

        UI.resize(vp.w, vp.h, dw, dh, dx, dy);
        RoomUI.resize(vp.w, vp.h, dw, dh, dx, dy);
        this.camera.setViewport(vp.w, vp.h);

        this.g.imageSmoothingEnabled = false;
        this.g.setTransform(1, 0, 0, 1, 0, 0);
    }

    async loadRoomFromZip(zipBuffer) {
        const entries = await readZip(zipBuffer);
        await this._buildFromEntries(entries);
    }

    async _buildFromEntries(entries) {
        const dec = decodeUTF8;

        if (!entries['room.json']) throw new Error('缺少 room.json');
        const roomData = JSON.parse(dec(entries['room.json']));

        this.room = roomData;

        // ★ 加载房间 UI
        RoomUI.load(roomData.roomUI || { elements: [] });

        this.assets = {};
        for (const id of Object.keys(roomData.assets || {})) {
            const key = 'assets/' + id + '.png';
            if (entries[key]) {
                this.assets[id] = await loadImage(bytesToDataURL(entries[key], 'image/png'));
            }
        }

        this.elementAssets = {};
        for (const id of Object.keys(roomData.elementAssets || {})) {
            const spriteKey = 'elements/' + id + '.png';
            const metaKey = 'elements/' + id + '.json';
            if (!entries[spriteKey]) continue;
            const img = await loadImage(bytesToDataURL(entries[spriteKey], 'image/png'));
            const meta = entries[metaKey] ? JSON.parse(dec(entries[metaKey])) : {};
            this.elementAssets[id] = {
                id,
                name: meta.name || id,
                spriteImage: img,
                frameWidth: meta.frameWidth || 32,
                frameHeight: meta.frameHeight || 32,
                layers: meta.layers || [],
            };
        }

        this.characters = {};
        for (const id of Object.keys(roomData.characters || {})) {
            const spriteKey = 'characters/' + id + '.png';
            const jsonKey = 'characters/' + id + '.json';
            if (!entries[spriteKey]) continue;
            const img = await loadImage(bytesToDataURL(entries[spriteKey], 'image/png'));
            const jsonData = entries[jsonKey] ? JSON.parse(dec(entries[jsonKey])) : {};
            this.characters[id] = {
                id,
                name: (roomData.characters[id] && roomData.characters[id].name) || jsonData.projectName || id,
                sprite: img,
                json: jsonData,
            };
        }

        this.events = {};
        for (const id of Object.keys(roomData.events || {})) {
            const key = 'events/' + id + '.js';
            const code = entries[key] ? dec(entries[key]) : '';
            try {
                const fn = evalModuleCode(code);
                this.events[id] = { id, name: fn.name || id, code, fn };
            } catch (e) {
                console.warn('事件解析失败：' + id, e);
                this.events[id] = { id, name: id, code, fn: null };
            }
        }

        this.characterScripts = {};
        for (const id of Object.keys(roomData.characterScripts || {})) {
            const key = 'characters/' + id + '.script.js';
            const code = entries[key] ? dec(entries[key]) : '';
            try {
                const fn = evalModuleCode(code);
                this.characterScripts[id] = { id, name: fn.name || id, code, fn };
            } catch (e) {
                console.warn('角色脚本解析失败：' + id, e);
            }
        }

        this.roomScript = null;
        if (entries['room.js']) {
            const code = dec(entries['room.js']);
            try {
                const fn = evalModuleCode(code);
                this.roomScript = fn;
            } catch (e) {
                console.warn('房间脚本解析失败', e);
            }
        }

        const cam = roomData.camera || { x: 0, y: 0, zoom: 1, follow: false };
        this.camera.setRoomSize(roomData.width, roomData.height);
        this.camera.setZoom(cam.zoom || 1);
        this.camera.setBounds((roomData.cameraLayer && roomData.cameraLayer.ranges) || []);
        this.camera.setPosition(cam.x || 0, cam.y || 0);
        this.camera.following = !!cam.follow;

        this.elements.clear();
        this.actors = [];
        this.player = null;

        const groups = ['interaction', 'background', 'element', 'character'];
        for (const group of groups) {
            if (!roomData.layerGroups[group]) continue;
            for (const layer of roomData.layerGroups[group]) {
                for (const el of (layer.elements || [])) {
                    if (el.type === 'character') {
                        const data = this.characters[el.characterId];
                        if (!data) {
                            console.warn('角色资源不存在:', el.characterId);
                            continue;
                        }
                        const c = new Character(data, el.x, el.y, {
                            isPlayer: el.isPlayer,
                            acceptLight: el.acceptLight,
                            acceptLightFrom: el.acceptLightFrom,
                            superLight: el.superLight,
                            direction: el.direction || 'down',
                        });
                        c.characterId = data.id;
                        c.name = data.name;
                        c.canWalk = (nx, ny) => this.canWalkTo(nx, ny);
                        c.zIndex = (typeof el.zIndex === 'number') ? el.zIndex : 0;
                        c._sourceGroup = group;
                        c._sourceLayerId = layer.id;
                        c.visible = el.visible !== false;
                        c._fromRoomJson = true;
                        c._isPlayerFlag = (el.isPlayer === true);
                        this.actors.push(c);

                        if (el.isPlayer === true) this.player = c;
                    } else {
                        const inst = new ElementInstance(el, this.assets, this.elementAssets);
                        inst._groupId = group;
                        inst._layerId = layer.id;
                        inst._layerKind = layer.kind || null;
                        inst.x = Number(inst.x) || 0;
                        inst.y = Number(inst.y) || 0;
                        inst.w = Number(inst.w) || 0;
                        inst.h = Number(inst.h) || 0;
                        this.elements.set(el.id, inst);
                    }
                }
            }
        }

        this._walkables = [];
        this._nowalkables = [];
        this._reflections = [];
        for (const inst of this.elements.values()) {
            if (inst.type === 'walkable') this._walkables.push(inst);
            else if (inst.type === 'nowalkable') this._nowalkables.push(inst);
            else if (inst.type === 'reflection') this._reflections.push(inst);
        }

        this._actorObstacleCache.clear();
        this._bakeLight();
        this._lastLightSnap = this._lightSnapshot();

        this._resize();
    }

    _lightSnapshot() {
        const parts = [];
        for (const L of this.elements.values()) {
            if (L.type !== 'light') continue;
            parts.push(
                L.id + '|' + L.x + '|' + L.y + '|' + L.w + '|' + L.h + '|' +
                L.radius + '|' + L.intensity + '|' + L.color + '|' + L.shape + '|' +
                (L.visible === false ? 0 : 1)
            );
        }
        for (const actor of this.actors) {
            if (!actor.superLight) continue;
            parts.push(
                'actor:' + actor.x.toFixed(1) + '|' + actor.y.toFixed(1) +
                '|' + actor.direction + '|' + actor.frameIndex
            );
        }
        return parts.join(',');
    }

    _buildActorObstacle(actor) {
        if (!actor || !actor.sprite) return null;
        if (!actor.sprite.complete || actor.sprite.naturalWidth === 0) return null;

        const fw = actor.frameWidth;
        const fh = actor.frameHeight;
        const dirIdx = { down: 0, up: 1, left: 2, right: 3 }[actor.direction] || 0;
        const globalFrame = dirIdx * 3 + actor.frameIndex;
        const sx = globalFrame * fw;

        const cacheKey = (actor.characterId || 'a') + '|' + actor.direction + '|' + actor.frameIndex;

        let relPoints = null;
        if (this._actorObstacleCache.has(cacheKey)) {
            relPoints = this._actorObstacleCache.get(cacheKey);
        } else {
            if (!this._actorMaskCanvas) {
                this._actorMaskCanvas = document.createElement('canvas');
                this._actorMaskCtx = this._actorMaskCanvas.getContext('2d', { willReadFrequently: true });
            }
            const c = this._actorMaskCanvas;
            if (c.width !== fw || c.height !== fh) {
                c.width = fw;
                c.height = fh;
            }
            const ctx = this._actorMaskCtx;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, fw, fh);
            try {
                ctx.drawImage(actor.sprite, sx, 0, fw, fh, 0, 0, fw, fh);
            } catch (e) {
                return null;
            }

            let imgData;
            try {
                imgData = ctx.getImageData(0, 0, fw, fh);
            } catch (e) {
                return null;
            }
            const d = imgData.data;

            let minX = fw, minY = fh, maxX = -1, maxY = -1;
            for (let y = 0; y < fh; y++) {
                for (let x = 0; x < fw; x++) {
                    if (d[(y * fw + x) * 4 + 3] > 20) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            if (maxX < minX || maxY < minY) return null;

            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const numRays = 16;
            const maxR = Math.max(maxX - minX, maxY - minY) / 2 + 4;
            relPoints = [];
            for (let i = 0; i < numRays; i++) {
                const a = i / numRays * Math.PI * 2;
                const ddx = Math.cos(a), ddy = Math.sin(a);
                let maxDist = 0;
                for (let t = 0; t < maxR * 2; t += 0.5) {
                    const px = Math.floor(cx + ddx * t);
                    const py = Math.floor(cy + ddy * t);
                    if (px < 0 || px >= fw || py < 0 || py >= fh) break;
                    if (d[(py * fw + px) * 4 + 3] > 128) maxDist = t;
                }
                relPoints.push({ x: cx + ddx * maxDist, y: cy + ddy * maxDist });
            }
            this._actorObstacleCache.set(cacheKey, relPoints);
        }

        if (!relPoints || relPoints.length < 3) return null;

        const ox = actor.x - actor.pivot.x;
        const oy = actor.y - actor.pivot.y;
        return {
            kind: 'polygon',
            points: relPoints.map(p => ({ x: ox + p.x, y: oy + p.y })),
        };
    }

    _bakeLight() {
        const room = this.room;
        if (!room) return;

        const W = room.width, H = room.height;
        const GROUPS = ['interaction', 'background', 'element'];

        const lights = [];
        for (const inst of this.elements.values()) {
            if (inst.type !== 'light') continue;
            if (inst.visible === false) continue;
            const radius = inst.radius || 0;
            const intensity = inst.intensity != null ? inst.intensity : 1;
            if (radius < 20 || intensity < 0.05) continue;

            const cx = inst.shape === 'point' ? inst.x : inst.x + inst.w / 2;
            const cy = inst.shape === 'point' ? inst.y : inst.y + inst.h / 2;
            const R = inst.shape === 'point' ? radius : Math.max(inst.w, inst.h) / 2 + radius;

            lights.push({
                cx, cy, radius: R, intensity,
                color: hexToRgb(inst.color || '#ffcc66'),
                group: (GROUPS.includes(inst._groupId) ? inst._groupId : 'element'),
            });
        }

        const obstacles = [];
        for (const inst of this.elements.values()) {
            if (inst.type === 'light') continue;
            if (inst.visible === false) continue;
            if (inst.data.castsShadow === false) continue;
            if (!['sprite', 'tile', 'element', 'rect', 'circle'].includes(inst.type)) continue;
            const b = getElementBounds(inst.data);
            if (b.w < 1 || b.h < 1) continue;
            if (inst.type === 'circle') {
                obstacles.push({ kind: 'circle', cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 });
            } else {
                obstacles.push({ kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h });
            }
        }

        for (const actor of this.actors) {
            if (!actor.superLight) continue;
            if (actor.visible === false) continue;
            const obs = this._buildActorObstacle(actor);
            if (obs) obstacles.push(obs);
        }

        const lightMaps = {};
        for (const g of GROUPS) lightMaps[g] = new Float32Array(W * H);

        if (!this._maskCanvas) {
            this._maskCanvas = document.createElement('canvas');
            this._maskCanvas.width = W;
            this._maskCanvas.height = H;
            this._maskCtx = this._maskCanvas.getContext('2d', { willReadFrequently: true });
        }
        const mg = this._maskCtx;
        const LEVELS = 6;

        for (const L of lights) {
            const polygon = computeLightPolygon(L.cx, L.cy, L.radius, obstacles, 120);
            if (polygon.length < 3) continue;

            mg.clearRect(0, 0, W, H);
            mg.fillStyle = '#fff';
            mg.beginPath();
            mg.moveTo(polygon[0].x, polygon[0].y);
            for (let i = 1; i < polygon.length; i++) mg.lineTo(polygon[i].x, polygon[i].y);
            mg.closePath();
            mg.fill();

            const minX = Math.max(0, Math.floor(L.cx - L.radius));
            const minY = Math.max(0, Math.floor(L.cy - L.radius));
            const maxX = Math.min(W, Math.ceil(L.cx + L.radius));
            const maxY = Math.min(H, Math.ceil(L.cy + L.radius));
            const mw = maxX - minX, mh = maxY - minY;
            if (mw <= 0 || mh <= 0) continue;

            let maskData;
            try { maskData = mg.getImageData(minX, minY, mw, mh); } catch (e) { continue; }
            const md = maskData.data;

            const lm = lightMaps[L.group];

            for (let y = 0; y < mh; y++) {
                for (let x = 0; x < mw; x++) {
                    const mi = (y * mw + x) * 4;
                    if (md[mi] < 128) continue;

                    const wx = minX + x, wy = minY + y;
                    const dx = wx + 0.5 - L.cx;
                    const dy = wy + 0.5 - L.cy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > L.radius) continue;

                    let t = 1 - dist / L.radius;
                    t = Math.ceil(t * LEVELS) / LEVELS;
                    t *= L.intensity;
                    if (t <= 0) continue;

                    lm[wy * W + wx] += t;
                }
            }
        }

        const ambient = (room.ambient && room.ambient.intensity) || 0;
        this._ambient = ambient;

        this._lightCanvasByGroup = {};
        this._lightCtxByGroup = {};
        for (const g of GROUPS) {
            const bc = document.createElement('canvas');
            bc.width = W; bc.height = H;
            const bg = bc.getContext('2d', { willReadFrequently: true });
            const imgData = bg.createImageData(W, H);
            const d = imgData.data;
            const lm = lightMaps[g];
            for (let i = 0; i < W * H; i++) {
                let strength = lm[i];
                if (strength > 1) strength = 1;
                const darkness = 1 - strength;
                d[i * 4] = 0;
                d[i * 4 + 1] = 0;
                d[i * 4 + 2] = 0;
                d[i * 4 + 3] = Math.floor(darkness * 255);
            }
            bg.putImageData(imgData, 0, 0);
            this._lightCanvasByGroup[g] = bc;
            this._lightCtxByGroup[g] = bg;
        }

        const bc = document.createElement('canvas');
        bc.width = W; bc.height = H;
        const bg = bc.getContext('2d', { willReadFrequently: true });
        const imgData = bg.createImageData(W, H);
        const d = imgData.data;

        for (let i = 0; i < W * H; i++) {
            let strength = ambient;
            for (const g of GROUPS) strength += lightMaps[g][i];
            if (strength > 1) strength = 1;
            const darkness = 1 - strength;
            d[i * 4] = 0;
            d[i * 4 + 1] = 0;
            d[i * 4 + 2] = 0;
            d[i * 4 + 3] = Math.floor(darkness * 255);
        }

        bg.putImageData(imgData, 0, 0);

        // ★ 反射区：在光照图上擦亮（地板反光 + 墙上镜子都不被暗化）
        for (const refl of this._reflections) {
            if (refl.visible === false) continue;
            const el = refl.data;
            const opacity = refl.opacity != null ? refl.opacity : (el.opacity != null ? el.opacity : 0.4);
            const eraseAlpha = clamp(0.3 + opacity * 0.55, 0.3, 0.85);

            bg.save();
            bg.globalCompositeOperation = 'destination-out';
            bg.globalAlpha = eraseAlpha;
            bg.beginPath();
            if (el.shape === 'circle') {
                bg.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
            } else if (el.shape === 'polygon' && el.points && el.points.length >= 3) {
                bg.moveTo(el.points[0].x, el.points[0].y);
                for (let i = 1; i < el.points.length; i++) bg.lineTo(el.points[i].x, el.points[i].y);
                bg.closePath();
            } else {
                bg.rect(el.x, el.y, el.w, el.h);
            }
            bg.fillStyle = '#000';
            bg.fill();
            bg.restore();

            bg.save();
            bg.globalCompositeOperation = 'lighter';
            bg.globalAlpha = 0.2 * opacity;
            bg.beginPath();
            if (el.shape === 'circle') {
                bg.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
            } else if (el.shape === 'polygon' && el.points && el.points.length >= 3) {
                bg.moveTo(el.points[0].x, el.points[0].y);
                for (let i = 1; i < el.points.length; i++) bg.lineTo(el.points[i].x, el.points[i].y);
                bg.closePath();
            } else {
                bg.rect(el.x, el.y, el.w, el.h);
            }
            bg.fillStyle = refl.tintColor || '#88bbdd';
            bg.fill();
            bg.restore();
        }

        this.lightCanvas = bc;
        this._lightCtx = bg;
    }

    _updateLightIfDirty() {
        const snap = this._lightSnapshot();
        if (snap !== this._lastLightSnap) {
            this._lastLightSnap = snap;
            this._bakeLight();
        }
    }

    _sampleLightContribution(ctx, x, y) {
        if (!ctx) return 0;
        const canvas = ctx.canvas;
        const W = canvas.width, H = canvas.height;
        const px = Math.round(x);
        const py = Math.round(y);
        if (px < 0 || px >= W || py < 0 || py >= H) return 0;
        try {
            const d = ctx.getImageData(px, py, 1, 1).data;
            const darkness = d[3] / 255;
            return Math.max(0, 1 - darkness);
        } catch (e) {
            return 0;
        }
    }

    _sampleLightForActor(actor) {
        if (!actor.acceptLight) return 1;
        const groups = actor.acceptLightFrom || ['interaction', 'background', 'element'];
        if (groups.length === 0) return 1;

        const x = actor.x;
        const y = actor.y - actor.pivot.y + actor.frameHeight * 0.65;

        let total = this._ambient;
        for (const g of groups) {
            total += this._sampleLightContribution(this._lightCtxByGroup[g], x, y);
        }
        return Math.min(1, total);
    }

    canWalkTo(x, y) {
        for (const nw of this._nowalkables) {
            if (pointInElement(x, y, nw.data)) return false;
        }
        if (this._walkables.length > 0) {
            for (const w of this._walkables) {
                if (pointInElement(x, y, w.data)) return true;
            }
            return false;
        }
        return true;
    }

    async start() {
        // ★ 防重入：已经在跑就不再启新循环
        if (this.running) {
            console.log('[Engine] start 被重复调用，忽略');
            return;
        }

        this.running = true;
        this._lastT = performance.now();

        UI.fadeAlpha = 1;
        UI.fadeTarget = 1;
        UI.fadeSpeed = 1;

        requestAnimationFrame(t => this._loop(t));
        await new Promise(r => setTimeout(r, 50));

        if (this.roomScript && typeof this.roomScript.onEnter === 'function') {
            try {
                await this.roomScript.onEnter(this.ctx);
            } catch (e) {
                console.error('房间脚本 onEnter 失败', e);
            }
        }

        await UI.fadeTo(0, 800);
    }

    _loop(t) {
        if (!this.running) return;
        const dt = Math.min(0.05, (t - this._lastT) / 1000);
        this._lastT = t;

        this._update(dt);
        this._render();
        Input.endFrame();

        requestAnimationFrame(tt => this._loop(tt));
    }

    _update(dt) {
        const movement = Input.getMovement();

        // ★ 融合摇杆输入（若摇杆被按下且超过阈值，覆盖键盘方向）
        const js = RoomUI.getJoystickVector();
        const THRESH = 0.3;
        if (Math.abs(js.dx) > THRESH || Math.abs(js.dy) > THRESH) {
            movement.left = js.dx < -THRESH;
            movement.right = js.dx > THRESH;
            movement.up = js.dy < -THRESH;
            movement.down = js.dy > THRESH;
        }

        RoomUI.update(dt);

        if (this.player) this.player.update(dt, movement);

        for (const a of this.actors) {
            if (a !== this.player) a.update(dt, { up: false, down: false, left: false, right: false });
        }
        for (const el of this.elements.values()) el.update(dt);
        this.camera.update(dt);

        this._checkInteract();
        this._checkWalkTriggers();

        if (this.roomScript && typeof this.roomScript.update === 'function') {
            try { this.roomScript.update(this.ctx, dt); } catch (e) { }
        }
        for (const a of this.actors) {
            const scriptId = a.scriptId;
            if (!scriptId) continue;
            const script = this.characterScripts[scriptId];
            if (script && script.fn && typeof script.fn.update === 'function') {
                try { script.fn.update(this.ctx, a, dt); } catch (e) { }
            }
        }

        this._updateLightIfDirty();

        for (const a of this.actors) {
            a.lightLevel = this._sampleLightForActor(a);
        }

        UI.updateFade(dt);
    }

    _collectRenderableLayers() {
        const list = [];
        for (const group of ['interaction', 'background', 'element', 'character']) {
            for (const layer of (this.room.layerGroups[group] || [])) {
                if (layer.visible === false) continue;
                list.push({
                    group,
                    layer,
                    z: this._layerZ(group, layer),
                });
            }
        }
        list.sort((a, b) => a.z - b.z);
        return list;
    }

    _renderWallLayer(g, layer) {
        const sorted = layer.elements.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        for (const el of sorted) {
            const inst = this.elements.get(el.id);
            if (!inst) continue;
            if (inst.type === 'light') continue;
            if (inst.type === 'reflection') {
                this._renderReflection(g, inst);
            } else {
                inst.draw(g);
            }
        }
    }

    _renderFloorLayer(g, layer, includeActors) {
        const items = [];
        for (const el of layer.elements) {
            if (!el.visible) continue;
            if (el.type === 'walkable' || el.type === 'nowalkable') continue;
            if (el.type === 'trigger') continue;
            if (el.type === 'light') continue;
            if (el.type === 'character') continue;
            const inst = this.elements.get(el.id);
            if (!inst) continue;
            items.push({
                inst,
                isActor: false,
                isReflection: inst.type === 'reflection',
                bottomY: inst.y + inst.h,
                z: inst.zIndex || 0,
            });
        }
        if (includeActors) {
            for (const actor of this.actors) {
                if (!actor.visible) continue;
                items.push({
                    inst: actor,
                    isActor: true,
                    isReflection: false,
                    bottomY: actor.y,
                    z: actor.zIndex || 0,
                });
            }
        }
        // ★ z 主导，z 相同才按 bottomY
        items.sort((a, b) => {
            if (a.z !== b.z) return a.z - b.z;
            return a.bottomY - b.bottomY;
        });
        for (const item of items) {
            if (item.isReflection) {
                this._renderReflection(g, item.inst);
            } else if (item.isActor) {
                this._drawActorWithLight(g, item.inst);
            } else {
                item.inst.draw(g);
            }
        }
    }

    _renderNormalLayer(g, layer) {
        const sorted = layer.elements.slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        for (const el of sorted) {
            const inst = this.elements.get(el.id);
            if (!inst) continue;
            if (inst.type === 'light') continue;
            if (inst.type === 'reflection') {
                this._renderReflection(g, inst);
            } else {
                inst.draw(g);
            }
        }
    }

    _drawActorWithLight(g, actor) {
        if (!actor.visible) return;

        if (!actor.acceptLight || actor.lightLevel >= 0.98) {
            actor.draw(g);
            return;
        }

        const fw = actor.frameWidth;
        const fh = actor.frameHeight;
        const dx = actor.x - actor.pivot.x;
        const dy = actor.y - actor.pivot.y;

        if (!this._actorTmpCanvas) {
            this._actorTmpCanvas = document.createElement('canvas');
            this._actorTmpCtx = this._actorTmpCanvas.getContext('2d');
        }
        const tc = this._actorTmpCanvas;
        if (tc.width !== fw || tc.height !== fh) {
            tc.width = fw;
            tc.height = fh;
        }
        const tg = this._actorTmpCtx;
        tg.setTransform(1, 0, 0, 1, 0, 0);
        tg.clearRect(0, 0, fw, fh);
        tg.imageSmoothingEnabled = false;

        const saveX = actor.x, saveY = actor.y;
        actor.x = actor.pivot.x;
        actor.y = actor.pivot.y;
        actor.draw(tg);
        actor.x = saveX;
        actor.y = saveY;

        const darkness = 1 - actor.lightLevel;
        if (darkness > 0.01) {
            tg.save();
            tg.globalCompositeOperation = 'source-atop';
            tg.fillStyle = `rgba(0,0,0,${darkness})`;
            tg.fillRect(0, 0, fw, fh);
            tg.restore();
        }

        g.drawImage(tc, dx, dy);
    }

    _renderReflection(g, reflInst) {
        const el = reflInst.data;
        const bx = reflInst.x, by = reflInst.y, bw = reflInst.w, bh = reflInst.h;
        if (bw <= 0 || bh <= 0) return;

        const tintColor = reflInst.tintColor || el.tintColor || '#88bbdd';
        const opacity = reflInst.opacity != null ? reflInst.opacity : (el.opacity != null ? el.opacity : 0.4);
        // 墙层的反射当镜子；其它层（地板 / 元素 / 背景）都当反光地面
        const isMirror = (reflInst._layerKind === 'wall');

        g.save();

        // 裁剪到反射区形状
        g.beginPath();
        if (el.shape === 'circle') {
            g.ellipse(bx + bw / 2, by + bh / 2, Math.abs(bw / 2), Math.abs(bh / 2), 0, 0, Math.PI * 2);
        } else if (el.shape === 'polygon' && el.points && el.points.length >= 3) {
            g.moveTo(el.points[0].x, el.points[0].y);
            for (let i = 1; i < el.points.length; i++) g.lineTo(el.points[i].x, el.points[i].y);
            g.closePath();
        } else {
            g.rect(bx, by, bw, bh);
        }
        g.clip();

        // 反射区底色调（淡蓝/淡色调）
        g.globalAlpha = Math.min(1, opacity * 0.9);
        g.fillStyle = tintColor;
        g.fillRect(bx, by, bw, bh);
        g.globalAlpha = 1;

        if (isMirror) {
            // ============ 墙上镜子：上下翻转 + 反转顺序 ============
            const mirrorBottom = by + bh;

            const items = [];
            for (const inst of this.elements.values()) {
                if (inst === reflInst) continue;
                if (inst.visible === false) continue;
                if (inst.type === 'reflection' || inst.type === 'light') continue;
                if (inst.type === 'walkable' || inst.type === 'nowalkable') continue;
                if (inst.type === 'trigger') continue;
                if (inst._layerKind === 'wall') continue;
                items.push({ obj: inst, isActor: false, bottomY: inst.y + inst.h, h: inst.h });
            }
            for (const actor of this.actors) {
                if (!actor.visible) continue;
                items.push({ obj: actor, isActor: true, bottomY: actor.y, h: actor.frameHeight });
            }
            items.sort((a, c) => c.bottomY - a.bottomY);

            const dirFlip = { down: 'up', up: 'down', left: 'left', right: 'right' };

            for (const item of items) {
                const obj = item.obj;
                const newTop = 2 * mirrorBottom - item.bottomY;
                const newBottom = newTop + item.h;

                if (newBottom < by) continue;
                if (newTop > by + bh) continue;

                g.save();
                g.globalAlpha = Math.min(1, opacity * 1.8);

                if (item.isActor) {
                    const origY = obj.y;
                    const origDir = obj.direction;
                    obj.y = newTop + obj.frameHeight;
                    obj.direction = dirFlip[origDir] || origDir;
                    obj.draw(g);
                    obj.y = origY;
                    obj.direction = origDir;
                } else {
                    const origY = obj.y;
                    obj.y = newTop;
                    obj.draw(g);
                    obj.y = origY;
                }
                g.restore();
            }
        } else {
            // ============ 地板 / 元素 / 背景层反射：每个元素以自身下沿为轴向下镜像 ============
            const drawn = new Set();
            for (const src of this.elements.values()) {
                if (src === reflInst) continue;
                if (src.visible === false) continue;
                if (src._layerKind === 'wall') continue;                 // 墙层元素不参与地板反射
                if (src.type === 'reflection' || src.type === 'light') continue;
                if (src.type === 'walkable' || src.type === 'nowalkable') continue;
                if (src.type === 'trigger') continue;
                if (drawn.has(src.id)) continue;
                drawn.add(src.id);

                const sb = getElementBounds(src.data);
                if (sb.x + sb.w < bx || sb.x > bx + bw) continue;

                const srcBottom = sb.y + sb.h;
                const mirrorBottom2 = srcBottom + sb.h;
                if (mirrorBottom2 < by) continue;      // 镜像后太靠上，跟反射区没交集
                if (srcBottom > by + bh) continue;     // 元素整体在反射区下方，不反射

                g.save();
                g.globalAlpha = Math.min(1, opacity * 1.8);
                g.translate(0, 2 * srcBottom);
                g.scale(1, -1);
                src.draw(g);
                g.restore();
            }

            // 角色也参与地板反射
            for (const actor of this.actors) {
                if (!actor.visible) continue;
                const sb = {
                    x: actor.x - actor.pivot.x,
                    y: actor.y - actor.pivot.y,
                    w: actor.frameWidth,
                    h: actor.frameHeight,
                };
                if (sb.x + sb.w < bx || sb.x > bx + bw) continue;
                const srcBottom = actor.y;
                const mirrorBottom2 = srcBottom + sb.h;
                if (mirrorBottom2 < by) continue;
                if (srcBottom > by + bh) continue;

                g.save();
                g.globalAlpha = Math.min(1, opacity * 1.8);
                g.translate(0, 2 * srcBottom);
                g.scale(1, -1);
                actor.draw(g);
                g.restore();
            }
        }

        g.restore();
    }

    _render() {
        const g = this.g;
        const cam = this.camera;
        const room = this.room;
        if (!room) return;

        const cw = this.canvas.width;
        const ch = this.canvas.height;

        g.setTransform(1, 0, 0, 1, 0, 0);
        g.imageSmoothingEnabled = false;
        g.fillStyle = room.bgColor || '#1a1a20';
        g.fillRect(0, 0, cw, ch);

        g.save();
        g.scale(cam.zoom, cam.zoom);
        g.translate(-cam.x + cam._shakeX, -cam.y + cam._shakeY);
        g.imageSmoothingEnabled = false;

        const layerList = this._collectRenderableLayers();

        let firstFloorDone = false;
        let charactersRendered = false;

        for (const { group, layer } of layerList) {
            if (group === 'interaction' && layer.kind === 'wall') {
                this._renderWallLayer(g, layer);
            } else if (group === 'interaction' && layer.kind === 'floor') {
                this._renderFloorLayer(g, layer, !firstFloorDone);
                firstFloorDone = true;
                charactersRendered = true;
            } else if (group === 'background' || group === 'element') {
                this._renderNormalLayer(g, layer);
            }
        }

        if (!charactersRendered) {
            for (const actor of this.actors) {
                this._drawActorWithLight(g, actor);
            }
        }

        g.restore();

        if (this.lightCanvas) {
            g.save();
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.imageSmoothingEnabled = false;
            const srcX = cam.x;
            const srcY = cam.y;
            const srcW = cam.vpW / cam.zoom;
            const srcH = cam.vpH / cam.zoom;
            g.drawImage(this.lightCanvas, srcX, srcY, srcW, srcH, 0, 0, cw, ch);
            g.restore();
        }

        const hud = document.getElementById('debug-hud');
        if (hud) {
            const lines = [];
            lines.push(`CAM ${cam.x.toFixed(0)},${cam.y.toFixed(0)} ×${cam.zoom.toFixed(2)}`);
            lines.push(`VP ${cam.vpW}×${cam.vpH}  ROOM ${room.width}×${room.height}`);
            lines.push(`ELEMENTS ${this.elements.size}  ACTORS ${this.actors.length}`);
            if (this.player) {
                lines.push(`PLAYER ${this.player.x.toFixed(0)},${this.player.y.toFixed(0)} [${this.player.direction}] L=${this.player.lightLevel.toFixed(2)} SL=${this.player.superLight ? 1 : 0} RJ=${this.player._fromRoomJson ? 1 : 0}`);
            } else {
                lines.push(`PLAYER 无`);
            }
            lines.push(`WALK ${this._walkables.length}  NOWALK ${this._nowalkables.length}`);
            lines.push(`CAM BOUNDS ${(this.camera.bounds || []).length}  REFL ${this._reflections.length}`);
            hud.textContent = lines.join('\n');
        }
    }

    _checkInteract() {
        if (!this.player) {
            this._interactTargets = [];
            this._interactIndex = 0;
            RoomUI.setInteractTargets([], 0);
            return;
        }
        const p = this.player;
        const R = this.interactRadius;
        const R2 = R * R;
        const found = [];

        for (const el of this.elements.values()) {
            if (!el.data.eventId) continue;
            if (el.data.eventTriggerType !== 'button') continue;
            const b = getElementBounds(el.data);
            const cx = clamp(p.x, b.x, b.x + b.w);
            const cy = clamp(p.y, b.y, b.y + b.h);
            const dx = p.x - cx;
            const dy = p.y - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 <= R2) {
                found.push({ el: el, d: Math.sqrt(d2) });
            }
        }

        found.sort((a, b) => a.d - b.d);
        this._interactTargets = found.map(f => f.el);

        if (this._interactIndex >= this._interactTargets.length) {
            this._interactIndex = 0;
        }

        RoomUI.setInteractTargets(this._interactTargets, this._interactIndex);
    }

    _checkWalkTriggers() {
        if (!this.player) return;
        const p = this.player;
        for (const el of this.elements.values()) {
            if (!el.data.eventId) continue;
            if (el.data.eventTriggerType !== 'walk') continue;
            const ev = this.events[el.data.eventId];
            if (!ev) continue;
            if (el.data.eventOnce && this._firedEvents.has(el.data.id)) continue;
            if (!pointInElement(p.x, p.y, el.data)) continue;
            this._firedEvents.add(el.data.id);
            this._fireEvent(el.data.eventId);
        }
    }

    _fireEvent(eventId) {
        const ev = this.events[eventId];
        if (!ev || !ev.fn || typeof ev.fn.run !== 'function') {
            console.warn('事件不存在或没有 run：', eventId);
            return;
        }
        try {
            Promise.resolve(ev.fn.run(this.ctx)).catch(e => {
                console.error('事件执行出错：' + eventId, e);
            });
        } catch (e) {
            console.error('事件执行出错：' + eventId, e);
        }
    }

    /* ============================================================
       ★ 脚本 spawnCharacter
       - 默认会替换掉"从 room.json 加载的默认 player"（除非 opts.isPlayer === false）
       - 明确的 opts.isPlayer === true → 强制成为 player
       - 明确的 opts.isPlayer === false → 只作为 NPC
       ============================================================ */
    async spawnCharacter(idOrName, x, y, opts) {
        let data = this.characters[idOrName];
        if (!data) {
            for (const k of Object.keys(this.characters)) {
                if (this.characters[k].name === idOrName) { data = this.characters[k]; break; }
            }
        }
        if (!data) {
            const keys = Object.keys(this.characters);
            if (keys.length > 0) {
                data = this.characters[keys[0]];
                console.warn(`角色"${idOrName}"不存在，使用"${data.name}"（id=${keys[0]}）`);
            }
        }
        if (!data) {
            console.error('没有角色资源');
            return null;
        }

        // ★ 查找同 characterId 的 room.json 角色作为"设置模板"
        let template = null;
        for (const a of this.actors) {
            if (a._fromRoomJson && a.characterId === data.id) {
                template = a;
                break;
            }
        }

        // ★ 合并 opts：显式 opts 优先，其次继承模板，最后默认值
        const mergedOpts = Object.assign({}, opts);
        if (template) {
            if (mergedOpts.superLight == null) mergedOpts.superLight = template.superLight;
            if (mergedOpts.acceptLight == null) mergedOpts.acceptLight = template.acceptLight;
            if (mergedOpts.acceptLightFrom == null) mergedOpts.acceptLightFrom = template.acceptLightFrom;
            if (mergedOpts.direction == null) mergedOpts.direction = template.direction;
        }

        const c = new Character(data, x, y, mergedOpts);
        c.characterId = data.id;
        c.name = data.name;
        c.canWalk = (nx, ny) => this.canWalkTo(nx, ny);
        c._fromRoomJson = false;

        // 保证 Character 构造后设置生效（Character 构造函数本身就会读取 opts）
        if (mergedOpts.superLight != null) c.superLight = mergedOpts.superLight;
        if (mergedOpts.acceptLight != null) c.acceptLight = mergedOpts.acceptLight;
        if (mergedOpts.acceptLightFrom) c.acceptLightFrom = mergedOpts.acceptLightFrom;

        for (const sid of Object.keys(this.characterScripts)) {
            const script = this.characterScripts[sid];
            if (sid.indexOf(data.id) >= 0 ||
                (script && script.name && script.name.indexOf(data.name) >= 0)) {
                c.scriptId = sid;
                break;
            }
        }

        this.actors.push(c);

        const isExplicitNpc = (opts && opts.isPlayer === false);
        const isExplicitPlayer = (opts && opts.isPlayer === true);

        if (isExplicitNpc) {
            // NPC，不动 player
        } else if (isExplicitPlayer) {
            this.player = c;
        } else {
            if (!this.player || this.player._fromRoomJson) {
                this.player = c;
            }
        }

        if (c.scriptId) {
            const script = this.characterScripts[c.scriptId];
            if (script && script.fn && typeof script.fn.onSpawn === 'function') {
                try { await script.fn.onSpawn(this.ctx, c); } catch (e) { console.warn('onSpawn 出错', e); }
            }
        }
        return c;
    }

    removeCharacter(c) {
        const i = this.actors.indexOf(c);
        if (i >= 0) this.actors.splice(i, 1);
        if (this.player === c) this.player = null;
    }

    getPlayer() { return this.player; }

    async switchRoom(roomId, x, y) {
        console.warn('切换房间功能未实现：', roomId);
    }
}