const fs = require("fs");
const path = require("path");
const os = require("os");

function readVarint(buf, i) {
  let n = 0n;
  let s = 0n;
  while (i < buf.length) {
    const b = BigInt(buf[i++]);
    n |= (b & 0x7fn) << s;
    if ((b & 0x80n) === 0n) break;
    s += 7n;
  }
  return [Number(n), i];
}

function decode(buf, indent = "") {
  let i = 0;
  const out = [];
  while (i < buf.length) {
    const start = i;
    let tag;
    [tag, i] = readVarint(buf, i);
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire === 0) {
      let v;
      [v, i] = readVarint(buf, i);
      out.push(`${indent}f${field} varint ${v}`);
    } else if (wire === 1) {
      i += 8;
      out.push(`${indent}f${field} i64`);
    } else if (wire === 2) {
      let len;
      [len, i] = readVarint(buf, i);
      const sub = buf.subarray(i, i + len);
      i += len;
      const asStr = sub.toString("utf8");
      const printable = /^[\x20-\x7e]+$/.test(asStr);
      out.push(`${indent}f${field} bytes[${len}]${printable ? ` "${asStr}"` : ""}`);
      if (!printable && len > 2) out.push(...decode(sub, indent + "  "));
    } else if (wire === 5) {
      const f = buf.readFloatLE(i);
      i += 4;
      out.push(`${indent}f${field} f32 ${f}`);
    } else {
      out.push(`${indent}unknown wire ${wire} at ${start}`);
      break;
    }
  }
  return out;
}

const body = fs.readFileSync(path.join(os.tmpdir(), "allai-grpc-body.bin"));
const len = body.readUInt32BE(1);
const msg = body.subarray(5, 5 + len);
console.log("flag", body[0], "len", len, "total", body.length);
console.log(decode(msg).join("\n"));
