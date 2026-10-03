/* 元素实例 */

class ElementInstance {
    constructor(data, assets, elementAssets) {
        this.data = data;
        this.id = data.id;
        this.name = data.name || data.id;
        this.type = data.type;

        this.x = data.x;
        this.y = data.y;
        this.w = data.w;
        this.h = data.h;
        this.opacity = data.opacity != null ? data.opacity : 1;
        this.visible = data.visible !== false;

        if (data.type === 'sprite' || data.type === 'tile') {
            this.image = assets[data.assetId] || null;
        }

        if (data.type === 'element') {
            const ea = elementAssets[data.elementAssetId];
            this.elementAsset = ea || null;
            this.image = ea ? ea.spriteImage : null;
            this.frameWidth = ea ? ea.frameWidth : 32;
            this.frameHeight = ea ? ea.frameHeight : 32;
            this.layers = ea ? ea.layers : [];
            this.currentLayerId = data.animation || (this.layers[0] && this.layers[0].id) || null;
            this.currentFrame = data.frameIndex || 0;
            this.frameDuration = 0.1;
            this.playing = false;
            this.flipH = data.spriteFlipH || false;
            this.flipV = data.spriteFlipV || false;
            this._timer = 0;
        }

        if (data.type === 'light') {
            this.color = data.color || '#ffcc66';
            this.intensity = data.intensity != null ? data.intensity : 1;
            this.radius = data.radius || 200;
            this.shape = data.shape || 'point';
        }

        if (data.type === 'rect' || data.type === 'circle') {
            this.fillColor = data.fillColor || '#4a6a8a';
        }

        if (data.type === 'reflection') {
            this.tintColor = data.tintColor || '#88bbdd';
            this.reflectRange = data.reflectRange || 200;
            this.shape = data.shape || 'rect';
        }

        // 互动层元信息（engine 注入）
        this._groupId = null;
        this._layerId = null;
        this._layerKind = null;

        // 角色光照
        this.acceptLight = data.acceptLight !== false;
        this.acceptLightFrom = data.acceptLightFrom || ['interaction', 'background', 'element'];
    }

    _getLayer() {
        if (!this.layers || !this.layers.length) return null;
        return this.layers.find(l => l.id === this.currentLayerId) || this.layers[0];
    }

    setFrame(i) {
        this.currentFrame = i;
        this.playing = false;
        this._timer = 0;
    }

    play() { this.playing = true; this._timer = 0; }
    stop() { this.playing = false; }

    update(dt) {
        if (!this.playing) return;
        if (this.type !== 'element') return;
        const layer = this._getLayer();
        if (!layer || !layer.frames || layer.frames.length <= 1) return;
        this._timer += dt;
        while (this._timer >= this.frameDuration) {
            this._timer -= this.frameDuration;
            this.currentFrame++;
            if (this.currentFrame >= layer.frames.length) this.currentFrame = 0;
        }
    }

    _currentGlobalFrame() {
        const layer = this._getLayer();
        if (!layer || !layer.frames || !layer.frames.length) return 0;
        const idx = ((this.currentFrame % layer.frames.length) + layer.frames.length) % layer.frames.length;
        return layer.frames[idx];
    }

    draw(g) {
        if (!this.visible) return;

        if (this.type === 'sprite') {
            if (this.image) g.drawImage(this.image, this.x, this.y, this.w, this.h);
        }
        else if (this.type === 'tile') {
            if (this.image) {
                const pat = g.createPattern(this.image, 'repeat');
                if (pat) { g.fillStyle = pat; g.fillRect(this.x, this.y, this.w, this.h); }
            }
        }
        else if (this.type === 'element') {
            if (!this.image) return;
            const fw = this.frameWidth, fh = this.frameHeight;
            const gf = this._currentGlobalFrame();
            const sx = gf * fw;
            g.save();
            g.globalAlpha *= this.opacity;
            if (this.flipH || this.flipV) {
                g.translate(this.x + this.w / 2, this.y + this.h / 2);
                g.scale(this.flipH ? -1 : 1, this.flipV ? -1 : 1);
                g.drawImage(this.image, sx, 0, fw, fh, -this.w / 2, -this.h / 2, this.w, this.h);
            } else {
                g.drawImage(this.image, sx, 0, fw, fh, this.x, this.y, this.w, this.h);
            }
            g.restore();
        }
        else if (this.type === 'rect') {
            g.save();
            g.globalAlpha *= this.opacity;
            g.fillStyle = this.fillColor;
            if (this.data.shape === 'polygon' && this.data.points) {
                g.beginPath();
                g.moveTo(this.data.points[0].x, this.data.points[0].y);
                for (let i = 1; i < this.data.points.length; i++) {
                    g.lineTo(this.data.points[i].x, this.data.points[i].y);
                }
                g.closePath();
                g.fill();
            } else {
                g.fillRect(this.x, this.y, this.w, this.h);
            }
            g.restore();
        }
        else if (this.type === 'circle') {
            g.save();
            g.globalAlpha *= this.opacity;
            g.beginPath();
            g.ellipse(this.x + this.w / 2, this.y + this.h / 2, this.w / 2, this.h / 2, 0, 0, Math.PI * 2);
            g.fillStyle = this.fillColor;
            g.fill();
            g.restore();
        }
    }
}