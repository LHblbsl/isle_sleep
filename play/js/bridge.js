/* ============================================================
   Bridge —— iframe 父子通信桥
   用法：
     父：Bridge.sendTo(iframeEl, 'load-room', { zipBuffer: buf });
     子：Bridge.on('load-room', msg => { ... });
     子：Bridge.send('room-changed', { roomData });
   ============================================================ */
var Bridge = {
    _handlers: {},

    isEmbedded() {
        return !!(window.parent && window.parent !== window);
    },

    on(type, handler) {
        if (!this._handlers[type]) this._handlers[type] = [];
        this._handlers[type].push(handler);
    },

    off(type, handler) {
        if (!this._handlers[type]) return;
        const i = this._handlers[type].indexOf(handler);
        if (i >= 0) this._handlers[type].splice(i, 1);
    },

    _dispatch(type, data) {
        const handlers = this._handlers[type];
        if (!handlers) return;
        for (const h of handlers) {
            try { h(data); } catch (e) { console.error('[Bridge] handler error:', type, e); }
        }
    },

    /* 发送到父窗口（嵌入模式）或指定 target */
    send(type, data, target) {
        const tgt = target || (this.isEmbedded() ? window.parent : null);
        if (!tgt) return;
        const msg = Object.assign({ __bridge: true, type }, data || {});
        try { tgt.postMessage(msg, '*'); } catch (e) { console.error('[Bridge] send error:', e); }
    },

    /* 发送到某个 iframe */
    sendTo(iframeEl, type, data) {
        if (!iframeEl || !iframeEl.contentWindow) return;
        const msg = Object.assign({ __bridge: true, type }, data || {});
        try { iframeEl.contentWindow.postMessage(msg, '*'); } catch (e) { console.error('[Bridge] sendTo error:', e); }
    },
};

window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || !data.__bridge) return;
    Bridge._dispatch(data.type, data);
});