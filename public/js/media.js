// media.js: files to pixels and back. pdf.js page renders, upright photo JPEGs, base64, and
// photos to one full-quality PDF for Drive. No DOM beyond throwaway canvases, no Firestore.
// Uses the classic-script globals pdfjsLib and jspdf that index.html loads before the modules.
import { DriveError } from "./drive.js";

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

export const makeCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export const canvasBlob = (cv, q) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", q));
export function blobB64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
export async function openPdfDoc(file) {
  if (!window.pdfjsLib) throw new Error("pdf.js missing");
  return pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
}
export async function renderPage(doc, n, edge, q) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(4, edge / Math.max(base.width, base.height)) });
  const cv = document.createElement("canvas");
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: cx, viewport: vp }).promise;
  page.cleanup();
  return canvasBlob(cv, q);
}
// A photo, upright (EXIF orientation applied), scaled so its long side is at most `edge`.
export async function photoJpeg(file, edge, q) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
  cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return canvasBlob(cv, q);
}

// ---------- photos to one PDF, at full quality ----------
// A JPEG that's already upright goes into the PDF byte for byte. Anything else (PNG, WebP, a JPEG
// whose EXIF says rotate) is redrawn upright at full size, capped near 16 megapixels because that's
// the largest canvas iPhone Safari allows, and saved at JPEG quality 0.92.
function jpegOrientation(buf) {
  try {
    const v = new DataView(buf);
    if (v.getUint16(0) !== 0xffd8) return -1;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const m = v.getUint16(o);
      if (m === 0xffe1 && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const ifd = t + v.getUint32(t + 4, le), n = v.getUint16(ifd, le);
        for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le); }
        return 1;
      }
      if (m === 0xffda || (m & 0xff00) !== 0xff00) return 1;
      o += 2 + v.getUint16(o + 2);
    }
    return 1;
  } catch { return -1; }
}
async function fullPage(file) {
  const buf = await file.arrayBuffer();
  if ((file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) && jpegOrientation(buf) === 1) return new Uint8Array(buf);
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, Math.sqrt(16_000_000 / (bmp.width * bmp.height)));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const cx = cv.getContext("2d");
  cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
  cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  return new Uint8Array(await (await canvasBlob(cv, 0.92)).arrayBuffer());
}
export async function photosToPdf(files) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) throw new DriveError("pdf");
  let pdf = null;
  for (const f of files) {
    const bytes = await fullPage(f);
    const p = new jsPDF().getImageProperties(bytes);
    const size = [612, Math.round((612 * p.height) / p.width)];  // letter width, the photo's own shape
    if (!pdf) pdf = new jsPDF({ unit: "pt", format: size, compress: true });
    else pdf.addPage(size);
    pdf.addImage(bytes, "JPEG", 0, 0, size[0], size[1]);
  }
  return pdf.output("blob");
}
