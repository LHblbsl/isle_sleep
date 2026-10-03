/* 键盘输入 */

const Input = {
    keys: {},
    _once: {},

    init() {
        // 自己页面直接监听键盘
        window.addEventListener('keydown', e => {
            const k = e.code;
            if (!this.keys[k]) this._once[k] = true;
            this.keys[k] = true;
            if (k === 'Space' || k === 'ArrowUp' || k === 'ArrowDown' ||
                k === 'ArrowLeft' || k === 'ArrowRight') {
                e.preventDefault();
            }
        });
        window.addEventListener('keyup', e => {
            this.keys[e.code] = false;
        });

        // ★ 接收父页面转发的键盘事件
        window.addEventListener('message', (e) => {
            const d = e.data;
            if (!d || !d.__extKey) return;
            const k = d.code;
            if (d.event === 'down') {
                if (!this.keys[k]) this._once[k] = true;
                this.keys[k] = true;
            } else if (d.event === 'up') {
                this.keys[k] = false;
            }
        });
    },

    getMovement() {
        return {
            up: !!(this.keys['KeyW'] || this.keys['ArrowUp']),
            down: !!(this.keys['KeyS'] || this.keys['ArrowDown']),
            left: !!(this.keys['KeyA'] || this.keys['ArrowLeft']),
            right: !!(this.keys['KeyD'] || this.keys['ArrowRight']),
        };
    },

    consumeOnce(code) {
        if (this._once[code]) { this._once[code] = false; return true; }
        return false;
    },

    endFrame() {
        this._once = {};
    },
};