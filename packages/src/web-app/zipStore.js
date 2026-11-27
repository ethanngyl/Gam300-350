/*!************************************************************************
\file zipStore.js
\author Ethan Ng Yong Le
\par Course: csd3401f26
\par Software Engineering Project 5
\date 27-11-2026
\brief
Minimal .zip writer (stored entries, no compression) so the web OBJ export
can hand over the .obj, its .mtl and its colour texture as one download.
No zip library needed; the archive is built as Blob parts, so a large .obj
is never copied into one big buffer.
- crc32(bytes, crc)
CRC-32 (zip and PNG flavour). Pass the previous result to continue it;
start with 0.
- zipStored(entries)
entries: [{ name, data }] where data is a Uint8Array or an array of them.
Returns a Blob of type application/zip.
**************************************************************************/

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; ++n) {
        let c = n
        for (let k = 0; k < 8; ++k) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
        table[n] = c >>> 0
    }
    return table
})()

export function crc32(bytes, crc = 0) {
    let c = (crc ^ 0xFFFFFFFF) >>> 0
    for (let i = 0; i < bytes.length; ++i) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
}

// Zip32 limit; larger files would need Zip64.
const MAX_ZIP_BYTES = 0xFFFFFFFF

function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
    const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    return { time, day }
}

export function zipStored(entries) {
    const encoder = new TextEncoder()
    const { time, day } = dosDateTime(new Date())
    const parts = []
    const central = []
    let offset = 0

    for (const entry of entries) {
        const chunks = Array.isArray(entry.data) ? entry.data : [entry.data]
        let size = 0
        let crc = 0
        for (const chunk of chunks) {
            size += chunk.length
            crc = crc32(chunk, crc)
        }
        if (size > MAX_ZIP_BYTES || offset + size > MAX_ZIP_BYTES) {
            throw new RangeError('The export is too large for a .zip file (over 4 GB).')
        }
        const name = encoder.encode(entry.name)

        const local = new DataView(new ArrayBuffer(30))
        local.setUint32(0, 0x04034b50, true)
        local.setUint16(4, 20, true) // version needed
        local.setUint16(6, 0, true) // flags
        local.setUint16(8, 0, true) // method: stored
        local.setUint16(10, time, true)
        local.setUint16(12, day, true)
        local.setUint32(14, crc, true)
        local.setUint32(18, size, true) // compressed size
        local.setUint32(22, size, true)
        local.setUint16(26, name.length, true)
        local.setUint16(28, 0, true) // extra length
        parts.push(local.buffer, name, ...chunks)

        const record = new DataView(new ArrayBuffer(46))
        record.setUint32(0, 0x02014b50, true)
        record.setUint16(4, 20, true) // version made by
        record.setUint16(6, 20, true) // version needed
        record.setUint16(8, 0, true)
        record.setUint16(10, 0, true)
        record.setUint16(12, time, true)
        record.setUint16(14, day, true)
        record.setUint32(16, crc, true)
        record.setUint32(20, size, true)
        record.setUint32(24, size, true)
        record.setUint16(28, name.length, true)
        // extra, comment, disk, internal and external attributes stay 0
        record.setUint32(42, offset, true)
        central.push(record.buffer, name)

        offset += 30 + name.length + size
    }

    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0)
    if (offset + centralSize > MAX_ZIP_BYTES) {
        throw new RangeError('The export is too large for a .zip file (over 4 GB).')
    }
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, entries.length, true) // entries on this disk
    end.setUint16(10, entries.length, true)
    end.setUint32(12, centralSize, true)
    end.setUint32(16, offset, true)

    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
}
