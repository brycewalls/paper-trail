// md5.js: MD5 of bytes, as lowercase hex. Web Crypto has no MD5, and Drive's checksum is MD5
// (md5Checksum), so the outbox's verification (#18) compares Drive's value with this one, the same
// check the iPhone app makes. Also used by the fake Drive (tools/fake/fake-backend.js) to answer
// files.get with a real md5Checksum. Owner: outbox. Leaf module: imports nothing.
//   md5(uint8ArrayOrArrayBuffer) -> "9e107d9d372bb6826bd81d3542a419d6"
//   await sha256Hex(bytesOrBlob)   -> the contentHash both apps write (#2), SHA-256 as lowercase hex
const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => (Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0));

export function md5(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const n = bytes.length;
  const padded = new Uint8Array((((n + 8) >>> 6) + 1) << 6);
  padded.set(bytes);
  padded[n] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (n * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(n / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const tmp = D; D = C; C = B;
      const x = (A + F + K[i] + M[g]) >>> 0;
      B = (B + ((x << S[i]) | (x >>> (32 - S[i])))) >>> 0;
      A = tmp;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// SHA-256 through Web Crypto: the docs record's contentHash and the duplicate check (#2), the same
// value the iPhone app's ContentHash.sha256Hex writes.
export async function sha256Hex(input) {
  const buf = input instanceof Blob ? await input.arrayBuffer() : input instanceof Uint8Array ? input : new Uint8Array(input);
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
