import { NextResponse } from "next/server";
import type { FitReport } from "@/lib/fit-report";
import { uploadReportToGithub } from "@/lib/report-upload";

/**
 * РЕЛЕЙ ОТЧЁТОВ → GITHUB (v1.14.12)
 * Браузер шлёт отчёт сюда (тот же origin — без CORS), сервер делает вызовы
 * GitHub API с серверным токеном. Токен не попадает в клиентский бандл,
 * все ошибки видны в логе сервера (dev.log).
 */

export const runtime = "nodejs";

/** Имя файла ограничиваем — уйдёт в путь к репозиторию. */
const SAFE_NAME = /^[\w.\-]{1,120}$/;

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = raw as { report?: FitReport; filename?: unknown };
    const report = body?.report;

    if (
      !report ||
      typeof report !== "object" ||
      !report.meta ||
      typeof report.meta.version !== "string" ||
      !Array.isArray(report.views)
    ) {
      return NextResponse.json(
        { error: "Отчёт повреждён: нет meta/views" },
        { status: 400 },
      );
    }

    const filename =
      typeof body.filename === "string" && SAFE_NAME.test(body.filename)
        ? body.filename
        : undefined;

    const result = await uploadReportToGithub(report, filename);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[report-upload] FAIL:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
