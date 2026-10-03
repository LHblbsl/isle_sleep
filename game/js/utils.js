/* 通用工具 */

function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
function lerp(a, b, t) { return a + (b - a) * t; }

function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16),
    };
}

function decodeUTF8(bytes) { return new TextDecoder().decode(bytes); }

function bytesToDataURL(bytes, mime) {
    let bin = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return 'data:' + (mime || 'application/octet-stream') + ';base64,' + btoa(bin);
}

function loadImage(dataURL) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = dataURL;
    });
}

function pointInElement(px, py, el) {
    if (el.shape === 'circle') {
        const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
        const dx = (px - cx) / (el.w / 2);
        const dy = (py - cy) / (el.h / 2);
        return dx * dx + dy * dy <= 1;
    }
    if (el.shape === 'polygon' && el.points && el.points.length >= 3) {
        let inside = false;
        const pts = el.points;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x, yi = pts[i].y;
            const xj = pts[j].x, yj = pts[j].y;
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }
    return px >= el.x && px <= el.x + el.w && py >= el.y && py <= el.y + el.h;
}

function getElementBounds(el) {
    if (el.type === 'light' && el.shape === 'point') {
        return { x: el.x - 4, y: el.y - 4, w: 8, h: 8 };
    }
    if (el.shape === 'polygon' && el.points && el.points.length) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of el.points) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    return { x: el.x, y: el.y, w: el.w, h: el.h };
}

function evalModuleCode(code) {
    if (!code || !code.trim()) throw new Error('脚本为空');
    const trimmed = code.trim();
    const idx = trimmed.indexOf('export default');
    if (idx >= 0) {
        const body = trimmed.slice(0, idx) + 'return ' + trimmed.slice(idx + 'export default'.length) + '\n;';
        return new Function(body)();
    }
    try {
        return new Function('return (' + trimmed + ');')();
    } catch (e) {
        return new Function(trimmed)();
    }
}

/* ============================================================
   射线求交工具（用于光锥）
   ============================================================ */

function raySeg(px, py, dx, dy, x1, y1, x2, y2, maxT) {
    const ex = x2 - x1, ey = y2 - y1;
    const denom = dx * ey - dy * ex;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((x1 - px) * ey - (y1 - py) * ex) / denom;
    const u = ((x1 - px) * dy - (y1 - py) * dx) / denom;
    if (t < 0 || t > maxT) return null;
    if (u < 0 || u > 1) return null;
    return t;
}

function rayRect(px, py, dx, dy, x, y, w, h, maxT) {
    let minT = maxT;
    const corners = [
        { x: x, y: y },
        { x: x + w, y: y },
        { x: x + w, y: y + h },
        { x: x, y: y + h },
    ];
    for (let i = 0; i < 4; i++) {
        const p1 = corners[i];
        const p2 = corners[(i + 1) % 4];
        const t = raySeg(px, py, dx, dy, p1.x, p1.y, p2.x, p2.y, minT);
        if (t !== null && t < minT) minT = t;
    }
    return minT;
}

function rayEllipse(px, py, dx, dy, cx, cy, rx, ry, maxT) {
    const nx = (px - cx) / rx, ny = (py - cy) / ry;
    const ndx = dx / rx, ndy = dy / ry;
    const a = ndx * ndx + ndy * ndy;
    if (a < 1e-9) return null;
    const b = 2 * (nx * ndx + ny * ndy);
    const c = nx * nx + ny * ny - 1;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a);
    const t2 = (-b + sq) / (2 * a);
    if (t1 >= 0 && t1 <= maxT) return t1;
    if (t2 >= 0 && t2 <= maxT) return t2;
    return null;
}

function rayPolygon(px, py, dx, dy, pts, maxT) {
    let minT = maxT;
    for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % pts.length];
        const t = raySeg(px, py, dx, dy, p1.x, p1.y, p2.x, p2.y, minT);
        if (t !== null && t < minT) minT = t;
    }
    return minT;
}

/* 计算光源的可见多边形（射线采样） */
function computeLightPolygon(lx, ly, radius, obstacles, sampleCount) {
    sampleCount = sampleCount || 120;
    const points = [];
    for (let i = 0; i < sampleCount; i++) {
        const angle = (i / sampleCount) * Math.PI * 2;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        let minT = radius;
        for (const obs of obstacles) {
            let t = null;
            if (obs.kind === 'rect') {
                t = rayRect(lx, ly, dx, dy, obs.x, obs.y, obs.w, obs.h, minT);
            } else if (obs.kind === 'circle') {
                t = rayEllipse(lx, ly, dx, dy, obs.cx, obs.cy, obs.rx, obs.ry, minT);
            } else if (obs.kind === 'polygon' && obs.points) {
                t = rayPolygon(lx, ly, dx, dy, obs.points, minT);
            }
            if (t !== null && t < minT) minT = t;
        }
        points.push({ x: lx + dx * minT, y: ly + dy * minT });
    }
    return points;
}