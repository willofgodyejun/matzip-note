// 전국 단위로 큰 CSV 에서 원하는 지역 줄만 뽑아 작은 CSV 로 저장합니다. (GitHub 에는 100MB 넘는 파일을 올릴 수 없어서)
// 사용: node scripts/slice-csv.mjs <원본.csv> <저장할.csv> "서울특별시 마포구" ["서울특별시 강남구" ...]
// 결과는 UTF-8 로 저장됩니다.
import fs from "node:fs";

const [src, dst, ...regions] = process.argv.slice(2);
if (!src || !dst || !regions.length) {
  console.error('사용법: node scripts/slice-csv.mjs 원본.csv 저장.csv "서울특별시 마포구" ["서울특별시 강남구" ...]');
  process.exit(1);
}
// 앞부분으로 인코딩 판별 (UTF-8 이 아니면 CP949)
const head = fs.readFileSync(src).subarray(0, 1 << 16);
let enc = "utf-8";
try { new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, head.lastIndexOf(10) + 1)); } catch { enc = "euc-kr"; }
const dec = new TextDecoder(enc);
const out = fs.createWriteStream(dst, { encoding: "utf8" });
let rest = "", first = true, kept = 0, total = 0;
for await (const chunk of fs.createReadStream(src, { highWaterMark: 1 << 20 })) {
  const text = rest + dec.decode(chunk, { stream: true });
  const lines = text.split("\n"); rest = lines.pop();
  for (const line of lines) {
    if (first) { out.write(line.replace(/^﻿/, "") + "\n"); first = false; continue; }
    total++;
    if (regions.some(r => line.includes(r))) { out.write(line + "\n"); kept++; }
  }
}
if (rest && regions.some(r => rest.includes(r))) { out.write(rest + "\n"); kept++; }
out.end();
console.log(`${total}줄 중 ${kept}줄 저장 → ${dst} (원본 인코딩 ${enc})`);
