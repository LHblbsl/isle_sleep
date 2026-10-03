/* 入口 */

const canvas = document.getElementById('game-canvas');
const engine = new Engine(canvas);

window.__engine = engine;

const loader = document.getElementById('loader');
const loaderStatus = document.getElementById('loader-status');
const btnDefault = document.getElementById('btn-load-default');
const fileZip = document.getElementById('file-zip');

function setStatus(msg) {
    if (loaderStatus) loaderStatus.textContent = msg;
}

async function startWithBuffer(buf) {
    try {
        setStatus('解析房间包…');
        await engine.loadRoomFromZip(buf);
        setStatus('启动…');
        loader.classList.add('hide');
        await engine.start();
    } catch (e) {
        console.error(e);
        setStatus('失败：' + e.message);
    }
}

btnDefault.addEventListener('click', async () => {
    setStatus('正在下载 data/room.zip …');
    try {
        const res = await fetch('data/room.zip');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const buf = await res.arrayBuffer();
        await startWithBuffer(buf);
    } catch (e) {
        console.error(e);
        setStatus('读取失败：' + e.message + '\n（把编辑器导出的 ZIP 复制到 game/data/room.zip）');
    }
});

fileZip.addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';
    const buf = await f.arrayBuffer();
    await startWithBuffer(buf);
});