/**
 * VERIFY v1.6.0 — сборка отчёта для отладки (fit-report.ts)
 * Запуск: bun scripts/verify-fit-report.ts
 *
 * Проверяем чистую логику buildFitReport (без браузера: фото → photo:null,
 * т.к. Image/canvas недоступны в bun) — структура, метаданные, имя файла,
 * JSON-раундтрип, прокидка captureMeta (гироскоп в момент спуска).
 */

import {
  buildFitReport,
  type ReportViewInput,
  type FitReportContext,
} from "../src/lib/fit-report";
import { APP_VERSION } from "../src/lib/app-version";
import type { Point } from "../src/lib/bike-fit";

let failed = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name} ${extra}`);
  }
}

const lms: Point[] = [
  { x: 0.51234, y: 0.23456, visibility: 0.98 },
  { x: 0.61, y: 0.44 },
];

const views: ReportViewInput[] = [
  {
    view: "side",
    url: null,
    landmarks: lms,
    analysis: { kneeAngle: { value: 142.4 }, hipAngle: { value: 78.1 }, side: "right" },
    error: null,
    captureMeta: { pitch: 91.2, roll: -1.5, gyroSupported: true, timestamp: 1_700_000_000_000 },
  },
  {
    view: "back",
    url: null,
    landmarks: null,
    analysis: null,
    error: "Не удалось обнаружить позу на фото.",
    captureMeta: null,
  },
  {
    view: "front",
    url: null,
    landmarks: null,
    analysis: null,
    error: null,
    captureMeta: null,
  },
];

const ctx: FitReportContext = {
  bikeType: "road",
  goal: "sport",
  complaints: ["knee_pain"],
  body: { height: 178, inseam: 83 },
  bike: { saddleHeight: 68, wheelbase: 995, wheelHeight: 668 },
};

const { report, json, filename } = await buildFitReport(views, ctx);
const parsed = JSON.parse(json) as typeof report;

console.log("\n=== verify-fit-report v1.6.0 ===\n");

// --- meta ---
check("meta.version = APP_VERSION", report.meta.version === APP_VERSION, report.meta.version);
check("meta.app = BikeSnap", report.meta.app === "BikeSnap");
check("meta.createdAt ISO", !Number.isNaN(Date.parse(report.meta.createdAt)));
check("meta.userAgent присутствует", report.meta.userAgent.length > 0);
check(
  "meta.screen: WxH в браузере / unknown в bun",
  typeof screen !== "undefined" ? /^\d+x\d+$/.test(report.meta.screen) : report.meta.screen === "unknown",
  report.meta.screen,
);
check("meta.orientation валиден", ["portrait", "landscape"].includes(report.meta.orientation));

// --- context ---
check("context.bikeType прокинут", report.context.bikeType === "road");
check("context.body прокинут", (report.context.body as { height: number }).height === 178);

// --- views ---
check("views: 3 ракурса", report.views.length === 3);
const side = report.views[0];
check("side: analyzed=true", side.analyzed === true);
check("side: analysis на месте", (side.analysis as { kneeAngle: { value: number } }).kneeAngle.value === 142.4);
check("side: landmarks округлены до 4 знаков", side.landmarks?.[0]?.x === 0.5123, String(side.landmarks?.[0]?.x));
check("side: landmarksCount = 2", side.landmarksCount === 2);
check("side: captureMeta прокинут (pitch/roll/gyro)", side.captureMeta?.pitch === 91.2 && side.captureMeta?.roll === -1.5 && side.captureMeta?.gyroSupported === true);
check("side: photo=null вне браузера (не падаем)", side.photo === null);
const back = report.views[1];
check("back: analyzed=false", back.analyzed === false);
check("back: error прокинут", back.error === "Не удалось обнаружить позу на фото.");
check("back: landmarks=null", back.landmarks === null);
check("front: captureMeta=null без камеры", report.views[2].captureMeta === null);

// --- filename / roundtrip ---
check("filename: bikesnap-report-*.json", /^bikesnap-report-v[\d.]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/.test(filename), filename);
check("JSON-раундтрип: views.length", parsed.views.length === 3);
check("JSON-раундтрип: version", parsed.meta.version === APP_VERSION);
check("JSON-раундтрип: captureMeta", parsed.views[0].captureMeta?.timestamp === 1_700_000_000_000);

// --- размер JSON без фото разумный ---
check("JSON без фото < 100 КБ", json.length < 100 * 1024, `${(json.length / 1024).toFixed(1)} КБ`);

console.log(`\nJSON: ${json.length} байт, файл: ${filename}\n`);
if (failed > 0) {
  console.error(`ПРОВАЛЕНО проверок: ${failed}`);
  process.exit(1);
}
console.log("ВСЕ ПРОВЕРКИ ЗЕЛЁНЫЕ");
