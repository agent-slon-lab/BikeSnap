/**
 * ЗАЛИВКА ОТЧЁТА НА GITHUB (v2.0.0 — серверный релей)
 * ===========================================================================
 * Идея пользователя: «создай на гите issue и когда пользов отправляет отчет
 * из анализа, то он автоматом там формируется и заливается на гит. а ты гит
 * мониторишь, скачиваешь и анализируешь и правишь».
 *
 * v2.0.0: код выполняется ТОЛЬКО НА СЕРВЕРЕ (импортируется из API-роута
 * /api/report-upload). Браузер шлёт отчёт на свой же origin, релей делает
 * вызовы GitHub API — никаких CORS и никакого токена в клиентском бандле.
 *
 * Что делает:
 *   1. Фото каждого ракурса (JPEG dataURL) → отдельным файлом в
 *      user-reports/<дата>/ через Contents API (base64).
 *   2. JSON отчёта (с НУЛЁМ вместо фото + photoFile-ссылками) → рядом.
 *   3. Issue с человекочитаемой сводкой (версия, ошибки, гироскоп, ссылки).
 *
 * Конфиг: GITHUB_TOKEN (server env) / NEXT_PUBLIC_GITHUB_TOKEN (fallback),
 * NEXT_PUBLIC_GITHUB_REPO — "owner/name".
 */

import type { FitReport } from "@/lib/fit-report";

const REPO = process.env.NEXT_PUBLIC_GITHUB_REPO || "agent-slon-lab/BikeSnap";
const TOKEN =
  process.env.GITHUB_TOKEN || process.env.NEXT_PUBLIC_GITHUB_TOKEN || "";
const API = "https://api.github.com";
const DIR = "user-reports";
const LABEL = "auto-report";

export interface GithubUploadResult {
  issueNumber: number;
  issueUrl: string;
  /** пути файлов внутри репозитория */
  files: string[];
}

export class GithubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function githubConfigured(): boolean {
  return TOKEN.length > 0;
}

function apiHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function api<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, init);
  } catch (e) {
    throw new GithubError(0, `сеть недоступна: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* не JSON — оставим текст */
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : "") || text.slice(0, 200) || res.statusText;
    throw new GithubError(res.status, `GitHub ${res.status}: ${msg}`);
  }
  return body as T;
}

/** UTF-8 безопасный base64 (btoa по частям — большие JSON рвут spread). */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

/** dataURL → { ext, base64Payload } или null, если формат неожиданный. */
function parseDataUrl(url: string): { ext: string; payload: string } | null {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(url);
  if (!m) return null;
  return { ext: m[1] === "jpg" ? "jpeg" : m[1], payload: m[2] };
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "view";
}

/**
 * PUT Contents API: создаёт файл. Если имя занято (422) — добавляет -2, -3…
 */
async function putFile(
  path: string,
  base64: string,
  message: string,
  attempt = 1,
): Promise<{ path: string; htmlUrl: string }> {
  const finalPath =
    attempt === 1 ? path : path.replace(/(\.[a-z0-9]+)$/i, `-${attempt}$1`);
  try {
    const data = await api<{ content: { html_url: string } }>(
      `/repos/${REPO}/contents/${finalPath}`,
      {
        method: "PUT",
        headers: apiHeaders(),
        body: JSON.stringify({ message, content: base64 }),
      },
    );
    return { path: finalPath, htmlUrl: data.content.html_url };
  } catch (e) {
    if (e instanceof GithubError && e.status === 422 && attempt < 5) {
      return putFile(path, base64, message, attempt + 1);
    }
    throw e;
  }
}

/**
 * Полная заливка: фото → JSON → issue. Последовательно, чтобы коммиты
 * не конкурировали за ref. filename — от клиента; проверяется роутом.
 */
export async function uploadReportToGithub(
  report: FitReport,
  filename?: string,
): Promise<GithubUploadResult> {
  if (!githubConfigured()) {
    throw new GithubError(0, "токен GitHub не настроен на сервере (.env)");
  }

  const fname =
    filename ||
    `bikesnap-report-${report.meta.version}-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19)}.json`;
  const base = fname.replace(/\.json$/i, "");
  const stamp = new Date(report.meta.createdAt);
  const dateStamp = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")}`;
  const commitMsg = `report: авто-отчёт из приложения (${report.meta.version})`;

  // 1. Фото отдельно — JSON легче без base64, фото удобно смотреть в репо
  const photoFiles: Array<{ path: string; htmlUrl: string; view: string }> = [];
  const jsonViews = report.views.map((v) => {
    if (!v.photo) return { ...v, photo: null as string | null, photoFile: null };
    const parsed = parseDataUrl(v.photo);
    if (!parsed) return { ...v, photo: null as string | null, photoFile: null };
    return { ...v, photo: null as string | null, pendingPhoto: parsed };
  });

  for (const v of jsonViews) {
    const pending = (v as { pendingPhoto?: { ext: string; payload: string } })
      .pendingPhoto;
    if (!pending) continue;
    const viewTag = sanitize(v.view);
    const up = await putFile(
      `${DIR}/${dateStamp}/${base}-photo-${viewTag}.${
        pending.ext === "jpeg" ? "jpg" : pending.ext
      }`,
      pending.payload,
      commitMsg,
    );
    photoFiles.push({ path: up.path, htmlUrl: up.htmlUrl, view: v.view });
    (v as { photoFile?: string }).photoFile = up.path;
    delete (v as { pendingPhoto?: unknown }).pendingPhoto;
  }

  // 2. JSON отчёта (фото вырезаны, проставлены photoFile)
  const reportForRepo: FitReport = { ...report, views: jsonViews };
  const jsonUpload = await putFile(
    `${DIR}/${dateStamp}/${fname}`,
    utf8ToBase64(JSON.stringify(reportForRepo, null, 2)),
    commitMsg,
  );

  // 3. Issue со сводкой
  const filesMd = [
    `- [report.json](${jsonUpload.htmlUrl})`,
    ...photoFiles.map((p) => `- [фото «${p.view}»](${p.htmlUrl})`),
  ].join("\n");

  const failed = report.views.filter((v) => v.error);
  const analyzed = report.views.filter((v) => v.analyzed);
  const status = failed.length
    ? `Ошибка ×${failed.length}`
    : analyzed.length
      ? `OK ×${analyzed.length}`
      : "Без анализа";

  const when = new Date(report.meta.createdAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Novosibirsk",
  });

  const viewsMd = report.views
    .map((v) => {
      const gyro = v.captureMeta?.gyroSupported
        ? `, гироскоп pitch ${Math.round(v.captureMeta.pitch)}° roll ${Math.round(
            v.captureMeta.roll,
          )}°`
        : "";
      return v.error
        ? `- **${v.view}**: ОШИБКА — ${v.error.slice(0, 300)}${gyro}`
        : v.analyzed
          ? `- **${v.view}**: анализ OK, точек ${v.landmarksCount}${gyro}`
          : `- **${v.view}**: без анализа, точек ${v.landmarksCount}${gyro}`;
    })
    .join("\n");

  const ctx = report.context as Record<string, unknown>;
  const ctxBits = [
    ctx.bikeType ? `тип: ${String(ctx.bikeType)}` : null,
    ctx.goal ? `цель: ${String(ctx.goal)}` : null,
    Array.isArray(ctx.complaints) && ctx.complaints.length
      ? `жалобы: ${ctx.complaints.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const body = [
    "Авто-отчёт из приложения BikeSnap (кнопка «Отправить отчёт» на шаге «Анализ»).",
    "",
    `- **Версия:** ${report.meta.version}`,
    `- **Когда:** ${when} (Нск), ${report.meta.createdAt}`,
    `- **Статус:** ${status}`,
    ctxBits ? `- **Контекст:** ${ctxBits}` : null,
    `- **Устройство:** ${report.meta.screen}, ${report.meta.orientation}, ${report.meta.language}`,
    `- **UA:** \`${report.meta.userAgent.slice(0, 160)}\``,
    "",
    "**Ракурсы**",
    viewsMd || "- нет ракурсов",
    "",
    "**Файлы в репозитории**",
    filesMd,
    "",
    "_Репозиторий открытый — фото и данные отчёта видны публично._",
  ]
    .filter((l) => l !== null)
    .join("\n");

  let issue: { number: number; html_url: string };
  try {
    issue = await api<{ number: number; html_url: string }>(
      `/repos/${REPO}/issues`,
      {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          title: `Отчёт ${report.meta.version} — ${when} — ${status}`,
          body,
          labels: [LABEL],
        }),
      },
    );
  } catch (e) {
    // метка не создалась/не назначилась — повторяем без labels
    if (e instanceof GithubError && (e.status === 422 || e.status === 403)) {
      issue = await api<{ number: number; html_url: string }>(
        `/repos/${REPO}/issues`,
        {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify({
            title: `Отчёт ${report.meta.version} — ${when} — ${status}`,
            body,
          }),
        },
      );
    } else {
      throw e;
    }
  }

  return {
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    files: [jsonUpload.path, ...photoFiles.map((p) => p.path)],
  };
}
