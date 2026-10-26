// 공공데이터 CSV → 페이지에서 쓰는 시군구별 JSON 으로 변환합니다. (외부 패키지 없이 Node 18+ 에서 실행)
//
//   data/raw/biz/*.csv       일반음식점·휴게음식점 인허가 정보 (행정안전부 지방행정 인허가 데이터)
//   data/raw/goodprice/*.csv 착한가격업소 현황 (지자체별)
//   data/raw/hygiene/*.csv   음식점 위생등급 지정 현황
//
// 출력: data/public/index.json, data/public/shards/<시도>_<시군구>.json
// 사용: node scripts/build-public-data.mjs [--raw data/raw] [--out data/public]

import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const RAW = args.raw || "data/raw";
const OUT = args.out || "data/public";
const CLOSED_KEEP_YEARS = 5; // 최근 5년 안에 폐업한 기록만 남김 (카카오에 남아 있는 폐업 가게를 걸러내는 용도)

/* ---------- CSV ---------- */
function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  const utf = new TextDecoder("utf-8", { fatal: true });
  try { return utf.decode(buf); } catch { return new TextDecoder("euc-kr").decode(buf); }
}
function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}
function readDir(kind) {
  const dir = path.join(RAW, kind);
  if (!fs.existsSync(dir)) return { rows: [], files: [] };
  const files = fs.readdirSync(dir).filter(f => /\.csv$/i.test(f)).sort();
  const rows = files.flatMap(f => parseCSV(decode(fs.readFileSync(path.join(dir, f)))).map(r => ({ ...r, __file: f })));
  return { rows, files };
}
// 헤더 이름이 파일마다 달라서 후보 중 처음 있는 값을 씀
const pick = (r, ...keys) => { for (const k of keys) { const hit = Object.keys(r).find(h => h.replace(/\s/g, "") === k.replace(/\s/g, "")); if (hit && r[hit]) return r[hit]; } return ""; };

/* ---------- 주소 ---------- */
const SIDO = { 서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주", 대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원특별자치도: "강원", 강원도: "강원", 충청북도: "충북", 충청남도: "충남", 전북특별자치도: "전북", 전라북도: "전북", 전라남도: "전남", 경상북도: "경북", 경상남도: "경남", 제주특별자치도: "제주" };
function normAddr(a) {
  if (!a) return "";
  let s = a.replace(/\(.*?\)/g, " ").split(",")[0].replace(/\s+/g, " ").trim();
  const [first, ...rest] = s.split(" ");
  return [SIDO[first] || first, ...rest].join(" ");
}
// "서울 마포구 양화로 160" → 도로명+건물번호 키, "서울 마포구 서교동 123-4" → 지번 키
function roadKey(a) { const m = normAddr(a).match(/^(\S+ \S+(?: \S+구)?) .*?(\S+(?:로|길)(?:\d+(?:번)?길)?) (\d+(?:-\d+)?)/); return m ? `${m[1]}|${m[2]}|${m[3]}` : ""; }
function jibunKey(a) { const m = normAddr(a).match(/^(\S+ \S+(?: \S+구)?) .*?(\S+(?:동|가|리|읍|면)) (?:산\s?)?(\d+(?:-\d+)?)/); return m ? `${m[1]}|${m[2]}|${m[3]}` : ""; }
function shardOf(a) { const p = normAddr(a).split(" "); return p.length >= 2 ? `${p[0]} ${p[1]}` : ""; }

/* ---------- 이름 ---------- */
const normName = n => (n || "").replace(/\(.*?\)|㈜|주식회사/g, "").replace(/[\s·.,'"&\-_/]/g, "").toLowerCase();

/* ---------- 좌표: EPSG:5174 (Bessel 중부원점 TM, 보정계수 없음) → WGS84 ---------- */
const BESSEL = { a: 6377397.155, f: 1 / 299.1528128 };
const WGS = { a: 6378137, f: 1 / 298.257223563 };
const TM = { lat0: 38 * Math.PI / 180, lon0: (127 + 10.405 / 3600) * Math.PI / 180, k0: 1, x0: 200000, y0: 500000 };
const TOWGS = [-115.8, 474.99, 674.11, 1.16, -2.31, -1.63, 6.43]; // dx dy dz(m), rx ry rz(초), ds(ppm)
function tmInverse(x, y) {
  const { a, f } = BESSEL, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
  const M = lat => a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * lat - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * lat) + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * lat) - (35 * e2 ** 3 / 3072) * Math.sin(6 * lat));
  const m = M(TM.lat0) + (y - TM.y0) / TM.k0;
  const mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const C1 = ep2 * Math.cos(p1) ** 2, T1 = Math.tan(p1) ** 2, N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5;
  const D = (x - TM.x0) / (N1 * TM.k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720);
  const lon = TM.lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5 / 120) / Math.cos(p1);
  return [lat, lon];
}
function toECEF(lat, lon, { a, f }) { const e2 = 2 * f - f * f, N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); return [N * Math.cos(lat) * Math.cos(lon), N * Math.cos(lat) * Math.sin(lon), N * (1 - e2) * Math.sin(lat)]; }
function fromECEF([X, Y, Z], { a, f }) {
  const e2 = 2 * f - f * f, b = a * (1 - f), ep2 = (a * a - b * b) / (b * b), p = Math.hypot(X, Y), th = Math.atan2(Z * a, p * b);
  return [Math.atan2(Z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3), Math.atan2(Y, X)];
}
function tm5174ToWgs(x, y) {
  const [lat, lon] = tmInverse(x, y);
  const [X, Y, Z] = toECEF(lat, lon, BESSEL);
  const [dx, dy, dz, rxs, rys, rzs, ds] = TOWGS, s = 1 + ds * 1e-6, r = Math.PI / 180 / 3600, rx = rxs * r, ry = rys * r, rz = rzs * r;
  // position vector 변환 (PROJ towgs84 와 같은 방식)
  const X2 = dx + s * (X - rz * Y + ry * Z), Y2 = dy + s * (rz * X + Y - rx * Z), Z2 = dz + s * (-ry * X + rx * Y + Z);
  const [la, lo] = fromECEF([X2, Y2, Z2], WGS);
  return [+(la * 180 / Math.PI).toFixed(6), +(lo * 180 / Math.PI).toFixed(6)];
}

/* ---------- 날짜 ---------- */
const ymd = s => { const d = (s || "").replace(/[^\d]/g, ""); return d.length >= 8 ? d.slice(0, 8) : ""; };
const now = new Date(), cutoff = `${now.getFullYear() - CLOSED_KEEP_YEARS}${String(now.getMonth() + 1).padStart(2, "0")}01`;

/* ---------- 1. 인허가 ---------- */
const shards = {}; // key -> {biz:[], good:[], hy:[]}
const shard = k => (shards[k] ||= { biz: [], good: [], hy: [] });
const stat = { biz: { files: [], rows: 0, kept: 0, open: 0, closed: 0 }, good: { files: [], rows: 0, kept: 0 }, hy: { files: [], rows: 0, kept: 0 } };

{
  const { rows, files } = readDir("biz"); stat.biz.files = files; stat.biz.rows = rows.length;
  for (const r of rows) {
    const statusName = pick(r, "영업상태명", "영업상태");
    const statusCode = pick(r, "영업상태구분코드", "영업상태코드");
    const open = statusCode === "01" || /영업|정상/.test(statusName);
    const closed = statusCode === "03" || /폐업/.test(statusName);
    if (!open && !closed) continue; // 휴업·취소 등은 제외
    const closedAt = ymd(pick(r, "폐업일자"));
    if (closed && closedAt && closedAt < cutoff) continue;
    const road = pick(r, "도로명전체주소", "도로명주소"), jibun = pick(r, "소재지전체주소", "지번주소", "소재지주소");
    const k = shardOf(road || jibun); if (!k) continue;
    const x = parseFloat(pick(r, "좌표정보(x)", "좌표정보(X)", "좌표정보x")), y = parseFloat(pick(r, "좌표정보(y)", "좌표정보(Y)", "좌표정보y"));
    const ll = isFinite(x) && isFinite(y) && x > 0 && y > 0 ? tm5174ToWgs(x, y) : null;
    shard(k).biz.push({
      n: pick(r, "사업장명", "업소명"), s: open ? 1 : 0, d: ymd(pick(r, "인허가일자")), c: closedAt || undefined,
      t: pick(r, "업태구분명", "위생업태명") || undefined, rk: roadKey(road) || undefined, jk: jibunKey(jibun) || undefined,
      la: ll?.[0], lo: ll?.[1]
    });
    stat.biz.kept++; open ? stat.biz.open++ : stat.biz.closed++;
  }
}

/* ---------- 2. 착한가격업소 ---------- */
{
  const { rows, files } = readDir("goodprice"); stat.good.files = files; stat.good.rows = rows.length;
  for (const r of rows) {
    const road = pick(r, "도로명주소", "소재지도로명주소", "주소", "소재지"), jibun = pick(r, "소재지주소", "지번주소", "소재지지번주소");
    const k = shardOf(road || jibun); if (!k) continue;
    const menus = [];
    for (let i = 1; i <= 5; i++) { const m = pick(r, `메뉴${i}`, `품목${i}`, `대표메뉴${i}`), p = pick(r, `가격${i}`, `가격${i}(원)`); if (m) menus.push([m, p.replace(/[^\d]/g, "")]); }
    if (!menus.length) { const m = pick(r, "주요취급품목", "대표메뉴", "품목", "메뉴"), p = pick(r, "가격(원)", "가격"); if (m) menus.push([m, p.replace(/[^\d]/g, "")]); }
    const la = parseFloat(pick(r, "위도")), lo = parseFloat(pick(r, "경도"));
    shard(k).good.push({ n: pick(r, "업소명", "상호", "업체명"), m: menus, rk: roadKey(road) || roadKey(jibun) || undefined, jk: jibunKey(jibun) || jibunKey(road) || undefined,
      la: isFinite(la) ? la : undefined, lo: isFinite(lo) ? lo : undefined, b: ymd(pick(r, "데이터기준일자")) || undefined });
    stat.good.kept++;
  }
}

/* ---------- 3. 위생등급 ---------- */
const gradeOf = g => /매우/.test(g) || /★★★|3/.test(g) ? 3 : /우수/.test(g) || /★★|2/.test(g) ? 2 : /좋음/.test(g) || /★|1/.test(g) ? 1 : 0;
{
  const { rows, files } = readDir("hygiene"); stat.hy.files = files; stat.hy.rows = rows.length;
  for (const r of rows) {
    const road = pick(r, "도로명주소", "소재지도로명주소", "주소", "소재지", "업소주소"), jibun = pick(r, "소재지주소", "지번주소");
    const k = shardOf(road || jibun); if (!k) continue;
    const g = gradeOf(pick(r, "지정등급", "위생등급", "등급", "평가등급")); if (!g) continue;
    const until = ymd(pick(r, "지정종료일자", "유효기간", "지정만료일자"));
    if (until && until < ymd(now.toISOString())) continue; // 기간이 끝난 지정은 제외
    shard(k).hy.push({ n: pick(r, "업소명", "상호명", "업체명", "사업장명"), g, d: ymd(pick(r, "지정일자", "지정일")) || undefined, u: until || undefined,
      rk: roadKey(road) || roadKey(jibun) || undefined, jk: jibunKey(jibun) || jibunKey(road) || undefined });
    stat.hy.kept++;
  }
}

/* ---------- 쓰기 ---------- */
const clean = o => JSON.parse(JSON.stringify(o)); // undefined 제거
fs.rmSync(path.join(OUT, "shards"), { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "shards"), { recursive: true });
const list = Object.keys(shards).sort();
for (const k of list) fs.writeFileSync(path.join(OUT, "shards", k.replace(/\s+/g, "_") + ".json"), JSON.stringify(clean(shards[k])));
const index = {
  updated: now.toISOString().slice(0, 10),
  sources: {
    biz: { files: stat.biz.files, open: stat.biz.open, closed: stat.biz.closed },
    good: { files: stat.good.files, count: stat.good.kept },
    hy: { files: stat.hy.files, count: stat.hy.kept }
  },
  shards: list
};
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log(`인허가 ${stat.biz.rows}행 → 영업 ${stat.biz.open} · 최근 폐업 ${stat.biz.closed}`);
console.log(`착한가격 ${stat.good.rows}행 → ${stat.good.kept}`);
console.log(`위생등급 ${stat.hy.rows}행 → ${stat.hy.kept}`);
console.log(`시군구 ${list.length}개: ${list.join(", ") || "(없음)"}`);
export { tm5174ToWgs, roadKey, jibunKey, normAddr };
