/* ZIP 解析（STORE + DEFLATE） */

async function readZip(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);

    let eocdIdx = -1;
    for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65557; i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocdIdx = i; break; }
    }
    if (eocdIdx < 0) throw new Error('不是有效的 ZIP 文件');

    const cdCount = view.getUint16(eocdIdx + 10, true);
    const cdOffset = view.getUint32(eocdIdx + 16, true);

    const entries = [];
    let p = cdOffset;
    for (let i = 0; i < cdCount; i++) {
        if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Central Directory 损坏');
        const method = view.getUint16(p + 10, true);
        const compSize = view.getUint32(p + 20, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const cmtLen = view.getUint16(p + 32, true);
        const localOffset = view.getUint32(p + 42, true);
        const name = new TextDecoder().decode(bytes.slice(p + 46, p + 46 + nameLen));
        entries.push({ name, method, compSize, localOffset });
        p += 46 + nameLen + extraLen + cmtLen;
    }

    const result = {};
    for (const f of entries) {
        if (f.name.endsWith('/')) continue;
        const lp = f.localOffset;
        if (view.getUint32(lp, true) !== 0x04034b50) throw new Error('Local Header 损坏：' + f.name);
        const lNameLen = view.getUint16(lp + 26, true);
        const lExtraLen = view.getUint16(lp + 28, true);
        const dataStart = lp + 30 + lNameLen + lExtraLen;
        const compData = bytes.slice(dataStart, dataStart + f.compSize);

        let data;
        if (f.method === 0) data = compData;
        else if (f.method === 8) data = await inflateRaw(compData);
        else throw new Error('不支持的压缩方式：' + f.method + '（' + f.name + '）');
        result[f.name] = data;
    }
    return result;
}

async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('浏览器不支持 DecompressionStream');
    }
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
}