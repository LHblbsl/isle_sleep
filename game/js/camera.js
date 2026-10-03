/* 相机 */

/* ============================================================
   ★ 摄像机范围辅助（模块级）
   ============================================================ */

function _camClosestPointOnSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return { x: x1, y: y1 };
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return { x: x1 + dx * t, y: y1 + dy * t };
}

function _camClosestPointInRange(px, py, r) {
    if (r.shape === 'circle') {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const rx = r.w / 2, ry = r.h / 2;
        const dx = (px - cx) / rx, dy = (py - cy) / ry;
        const d = Math.hypot(dx, dy);
        if (d <= 1) return { x: px, y: py };
        if (d < 1e-9) return { x: cx, y: cy };
        return { x: cx + dx / d * rx, y: cy + dy / d * ry };
    }
    if (r.shape === 'polygon' && r.points && r.points.length >= 3) {
        if (pointInElement(px, py, r)) return { x: px, y: py };
        let bestDist = Infinity, bestPt = null;
        for (let i = 0; i < r.points.length; i++) {
            const a = r.points[i];
            const b = r.points[(i + 1) % r.points.length];
            const pt = _camClosestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
            const d = Math.hypot(pt.x - px, pt.y - py);
            if (d < bestDist) { bestDist = d; bestPt = pt; }
        }
        return bestPt;
    }
    return {
        x: px < r.x ? r.x : (px > r.x + r.w ? r.x + r.w : px),
        y: py < r.y ? r.y : (py > r.y + r.h ? r.y + r.h : py),
    };
}

/* ============================================================
   Camera
   ============================================================ */

class Camera {
    constructor(vpW, vpH, roomW, roomH) {
        this.x = 0;
        this.y = 0;
        this.zoom = 1;
        this.vpW = vpW;
        this.vpH = vpH;
        this.roomW = roomW;
        this.roomH = roomH;
        this.target = null;
        this.following = false;
        this.shakeT = 0;
        this.shakeI = 0;
        this._shakeX = 0;
        this._shakeY = 0;
        this.bounds = [];   // ★ 摄像机活动范围（并集）
    }

    setViewport(w, h) { this.vpW = w; this.vpH = h; }
    setRoomSize(w, h) { this.roomW = w; this.roomH = h; }
    setZoom(z) { this.zoom = clamp(z, 0.1, 20); }

    setPosition(x, y) {
        this.x = x; this.y = y;
        this._clampToBounds();
    }

    /* ★ 设置摄像机活动范围（并集）。传空数组 = 取消限制 */
    setBounds(ranges) {
        this.bounds = Array.isArray(ranges) ? ranges : [];
    }

    /* 开始跟随 */
    follow(target) {
        this.target = target;
        this.following = true;
    }

    stopFollow() {
        this.following = false;
    }

    /* 平滑移动到目标位置（目标会先夹到范围内） */
    moveTo(x, y, ms) {
        const visW = this.vpW / this.zoom;
        const visH = this.vpH / this.zoom;
        const clamped = this._clampPointToBounds(x + visW / 2, y + visH / 2);
        const tx = clamped.x - visW / 2;
        const ty = clamped.y - visH / 2;

        return new Promise(resolve => {
            const sx = this.x, sy = this.y;
            const t0 = performance.now();
            const dur = ms || 500;
            const tick = () => {
                const t = Math.min(1, (performance.now() - t0) / dur);
                const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                this.x = sx + (tx - sx) * e;
                this.y = sy + (ty - sy) * e;
                if (t < 1) requestAnimationFrame(tick);
                else resolve();
            };
            tick();
        });
    }

    shake(intensity, ms) {
        this.shakeI = intensity;
        this.shakeT = ms / 1000;
    }

    /* ---------- 内部：把某个点夹到范围并集内 ---------- */
    _clampPointToBounds(cx, cy) {
        if (!this.bounds || this.bounds.length === 0) return { x: cx, y: cy };

        // 已在任一范围内 → 直接返回
        for (const r of this.bounds) {
            if (pointInElement(cx, cy, r)) return { x: cx, y: cy };
        }

        // 否则找最近的边界点
        let bestDist = Infinity, bestPt = null;
        for (const r of this.bounds) {
            const pt = _camClosestPointInRange(cx, cy, r);
            if (!pt) continue;
            const d = Math.hypot(pt.x - cx, pt.y - cy);
            if (d < bestDist) { bestDist = d; bestPt = pt; }
        }
        return bestPt || { x: cx, y: cy };
    }

    /* ---------- 内部：把当前相机中心夹到范围并集内 ---------- */
    _clampToBounds() {
        if (!this.bounds || this.bounds.length === 0) return false;

        const visW = this.vpW / this.zoom;
        const visH = this.vpH / this.zoom;
        const cx = this.x + visW / 2;
        const cy = this.y + visH / 2;

        // 已在范围内
        for (const r of this.bounds) {
            if (pointInElement(cx, cy, r)) return false;
        }

        const pt = this._clampPointToBounds(cx, cy);
        this.x = pt.x - visW / 2;
        this.y = pt.y - visH / 2;
        return true;
    }

    update(dt) {
        if (this.following && this.target) {
            const visW = this.vpW / this.zoom;
            const visH = this.vpH / this.zoom;

            // 期望的摄像机中心：玩家位置（并夹在房间内）
            let targetCx, targetCy;
            if (visW >= this.roomW) {
                targetCx = this.roomW / 2;
            } else {
                targetCx = clamp(this.target.x, visW / 2, this.roomW - visW / 2);
            }
            if (visH >= this.roomH) {
                targetCy = this.roomH / 2;
            } else {
                targetCy = clamp(this.target.y, visH / 2, this.roomH - visH / 2);
            }

            // ★ 摄像机范围夹取
            if (this.bounds && this.bounds.length > 0) {
                const clamped = this._clampPointToBounds(targetCx, targetCy);
                targetCx = clamped.x;
                targetCy = clamped.y;
            }

            const tx = targetCx - visW / 2;
            const ty = targetCy - visH / 2;
            this.x = lerp(this.x, tx, 0.15);
            this.y = lerp(this.y, ty, 0.15);
        }

        // ★ 不跟随状态下（脚本移动 / setPosition 之后）也要夹一次
        if (!this.following) {
            this._clampToBounds();
        }

        if (this.shakeT > 0) {
            this.shakeT -= dt;
            this._shakeX = (Math.random() - 0.5) * 2 * this.shakeI;
            this._shakeY = (Math.random() - 0.5) * 2 * this.shakeI;
        } else {
            this._shakeX = 0;
            this._shakeY = 0;
        }
    }
}