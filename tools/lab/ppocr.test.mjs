// Unit tests for the lab's PaddleOCR pipeline helpers (#101): public/js/lab/ppocr.js, and the
// benchmark's scoring (tools/lab/ocr-bench.mjs). No models and no browser: node --test tools/lab/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { minAreaRect, detSize, dbBoxes, ctcDecode, linesFromWords, parseDict, resizeRgba, cropLine } from "../../public/js/lab/ppocr.js";
import { levenshtein, scoreText } from "./ocr-bench.mjs";

test("detSize keeps the long side at the limit, in multiples of 32", () => {
  assert.deepEqual(detSize(1275, 1650, 1280), { w: 992, h: 1280 });
  assert.deepEqual(detSize(10, 10, 1280), { w: 1280, h: 1280 });
  const s = detSize(2016, 1512, 960);
  assert.equal(s.w % 32, 0); assert.equal(s.h % 32, 0); assert.equal(s.w, 960);
});

test("minAreaRect finds a turned rectangle's size and angle", () => {
  const pts = [];
  const a = (10 * Math.PI) / 180;
  for (let u = 0; u <= 100; u += 5) for (let v = 0; v <= 20; v += 5) pts.push(u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a));
  const r = minAreaRect(pts);
  const [long, short] = [Math.max(r.w, r.h), Math.min(r.w, r.h)];
  assert.ok(Math.abs(long - 100) < 0.5 && Math.abs(short - 20) < 0.5, `${long} x ${short}`);
});

test("dbBoxes turns a probability map into boxes in the picture's pixels", () => {
  const mw = 64, mh = 32, prob = new Float32Array(mw * mh);
  for (let y = 10; y < 16; y++) for (let x = 8; x < 40; x++) prob[y * mw + x] = 0.9;   // one line of text
  for (let y = 25; y < 26; y++) for (let x = 2; x < 4; x++) prob[y * mw + x] = 0.9;    // a speck, too small
  const boxes = dbBoxes(prob, mw, mh, 640, 320);
  assert.equal(boxes.length, 1);
  const b = boxes[0];
  assert.ok(b.score > 0.85);
  assert.ok(b.w > b.h && Math.abs(b.angle) < 0.01, "the text runs along the long side, level");
  assert.ok(b.x0 < 80 && b.x1 > 400 && b.y0 < 100 && b.y1 > 160, JSON.stringify(b));   // scaled 10x, grown by unclip
});

test("ctcDecode merges repeats, drops blanks, and maps the last class to a space", () => {
  const dict = ["a", "b"];          // classes: 0 blank, 1 a, 2 b, 3 space
  const steps = [1, 1, 0, 1, 3, 2, 2, 0];
  const probs = new Float32Array(steps.length * 4);
  steps.forEach((c, t) => { probs[t * 4 + c] = 0.9; });
  const r = ctcDecode(probs, steps.length, 4, dict);
  assert.equal(r.text, "aa b");
  assert.ok(Math.abs(r.score - 0.9) < 1e-6);
});

test("linesFromWords reads rows top to bottom, left to right, along the page's slant", () => {
  const level = linesFromWords([
    { text: "World", x: 200, y: 10, w: 80, h: 20 }, { text: "Hello", x: 10, y: 12, w: 80, h: 20 },
    { text: "Second", x: 10, y: 60, w: 90, h: 20 },
  ]);
  assert.deepEqual(level, ["Hello   World", "Second"]);
  // A page turned 3 degrees: the right column of row one sits as low as the left column of row two.
  const t = (3 * Math.PI) / 180;
  const at = (x, y, text) => ({ text, cx: x * Math.cos(t) - y * Math.sin(t), cy: x * Math.sin(t) + y * Math.cos(t), angle: t, bw: 200, bh: 24 });
  const slanted = linesFromWords([at(100, 100, "Wages"), at(1000, 100, "98,450.12"), at(100, 140, "Medicare"), at(1000, 140, "1,427.53")]);
  assert.deepEqual(slanted, ["Wages   98,450.12", "Medicare   1,427.53"]);
});

test("the dictionary file has the recognizer's 436 characters", () => {
  const dict = parseDict(readFileSync(new URL("../../public/lab-models/pp-ocrv5-mobile/dict-en.txt", import.meta.url), "utf8"));
  assert.equal(dict.length, 436);
  assert.equal(dict.slice(0, 10).join(""), "0123456789");
  assert.ok(dict.includes("$") && dict.includes("@") && dict.includes("W"));
});

test("resizeRgba and cropLine keep the picture's colors", () => {
  const w = 40, h = 20, data = new Uint8ClampedArray(w * h * 4).fill(255);
  const small = resizeRgba({ data, width: w, height: h }, 10, 5);
  assert.equal(small.width, 10); assert.equal(small.data[0], 255);
  const crop = cropLine({ data, width: w, height: h }, { cx: 20, cy: 10, w: 30, h: 10, angle: 0 });
  assert.equal(crop.w, 144);                                  // 48 high, 3 times as wide
  assert.ok(Math.abs(crop.data[0] - 1) < 1e-6);               // white normalizes to 1
});

test("the bench scores text with character and word edit distance", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein(["a", "b"], ["a", "c", "b"]), 1);
  const s = scoreText("Form W-2  Wage\nStatement", "Form W-2 Wage Staternent");
  assert.equal(s.chars, "Form W-2 Wage Statement".length);
  assert.equal(s.charErrors, 2);
  assert.equal(s.wordErrors, 1);
  assert.equal(s.wordHits, 3);
});
