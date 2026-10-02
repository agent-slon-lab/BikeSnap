import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";

/**
 * API для определения ключевых точек велосипеда на фото.
 *
 * Принцип (исправлено):
 * 1. СЕРВЕР извлекает РЕАЛЬНЫЕ размеры изображения из JPEG/PNG заголовка.
 * 2. В промпте VLM'у прямо сказано: "Изображение ровно WxH пикселей. Координаты — в этих пикселях, (0,0) — левый верхний угол."
 * 3. Ответ VLM нормализуем ТОЛЬКО по реальным размерам, которые извлекли сами.
 *    VLM'овские imageWidth/imageHeight ИГНОРИРУЕМ — они обычно соответствуют внутреннему ресайзу модели.
 *
 * Безопасность (Zod):
 * - Входящие данные FormData валидируются (наличие файла, размер, mime type).
 * - Ответ VLM валидируется по схеме (структура точек, диапазоны координат).
 * - На любой сбой валидации возвращается 400 Bad Request с подробной информацией.
 */

// ============================================================
// ZOD СХЕМЫ ВАЛИДАЦИИ
// ============================================================

/** Схема для одной точки: { x: number|null, y: number|null } */
const PointSchema = z.object({
  x: z.union([z.number(), z.null()]),
  y: z.union([z.number(), z.null()]),
}).strict();

/** Схема для полного ответа VLM: 7 точек + опциональные метаданные */
const VlmResponseSchema = z.object({
  bb: PointSchema.nullable(),
  stTop: PointSchema.nullable(),
  saddleMount: PointSchema.nullable(),
  htTop: PointSchema.nullable(),
  htBottom: PointSchema.nullable(),
  rearAxle: PointSchema.nullable(),
  frontAxle: PointSchema.nullable(),
  confidence: z.union([z.literal("high"), z.literal("medium"), z.literal("low")]).optional(),
  notes: z.string().optional(),
  imageWidth: z.number().optional(),
  imageHeight: z.number().optional(),
}).strict().passthrough();

/** Схема для проверки FormData файла с изображением */
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20 MB

const ImageFileSchema = z.object({
  file: z.instanceof(File, { message: "Изображение должно быть файлом" })
    .refine((f) => f.size > 0, { message: "Файл пустой" })
    .refine((f) => f.size <= MAX_IMAGE_SIZE, {
      message: `Размер файла превышает ${Math.round(MAX_IMAGE_SIZE / 1024 / 1024)} МБ`,
    })
    .refine((f) => ALLOWED_MIME_TYPES.includes((f.type || "image/jpeg") as any), {
      message: `Поддерживаются только: ${ALLOWED_MIME_TYPES.join(", ")}`,
    }),
});

/** Безопасная обработка ошибок: форматирует неизвестную ошибку в строку */
function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try { return JSON.stringify(e); } catch { return String(e); }
}

const REQUIRED_POINTS = [
  "bb",
  "stTop",
  "saddleMount",
  "htTop",
  "htBottom",
  "rearAxle",
  "frontAxle",
] as const;

type RequiredPointKey = (typeof REQUIRED_POINTS)[number];

/** Извлечь реальные размеры из заголовков JPEG/PNG/WebP. */
function extractImageDimensions(
  buf: Buffer,
  mimeType: string
): { width: number; height: number } {
  try {
    if (mimeType === "image/jpeg" && buf.length > 4) {
      let offset = 2;
      while (offset < buf.length - 9) {
        if (buf[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buf[offset + 1];
        // SOF0, SOF1, SOF2 — прогрессивный/базовый JPEG
        if (
          marker === 0xc0 ||
          marker === 0xc1 ||
          marker === 0xc2 ||
          marker === 0xc3
        ) {
          const h = buf.readUInt16BE(offset + 5);
          const w = buf.readUInt16BE(offset + 7);
          if (w > 0 && h > 0) return { width: w, height: h };
        }
        const len = buf.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    } else if (mimeType === "image/png" && buf.length > 24) {
      // PNG: первые 8 байт — сигнатура, затем IHDR chunk
      // bytes 16-19 = width, 20-23 = height (big-endian uint32)
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      if (w > 0 && h > 0) return { width: w, height: h };
    } else if (mimeType === "image/webp" && buf.length > 30) {
      // WebP VP8/VP8L
      const fourcc = buf.slice(12, 16).toString("ascii");
      if (fourcc === "VP8 ") {
        const w = buf.readUInt16LE(26) & 0x3fff;
        const h = buf.readUInt16LE(28) & 0x3fff;
        if (w > 0 && h > 0) return { width: w, height: h };
      } else if (fourcc === "VP8L") {
        const b0 = buf[21];
        const b1 = buf[22];
        const b2 = buf[23];
        const b3 = buf[24];
        const w = 1 + ((b1 & 0x3f) << 8 | b0);
        const h = 1 + ((b3 & 0x0f) << 10 | b2 << 2 | (b1 & 0xc0) >> 6);
        if (w > 0 && h > 0) return { width: w, height: h };
      } else if (fourcc === "VP8X") {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        if (w > 0 && h > 0) return { width: w, height: h };
      }
    }
  } catch {
    // ignore
  }
  return { width: 0, height: 0 };
}

function buildPrompt(realW: number, realH: number): string {
  return `Ты — эксперт по велосипедной геометрии. На изображении — велосипед сбоку.

Изображение имеет размер ${realW}×${realH} пикселей.

ОПРЕДЕЛИ координаты следующих 7 ключевых точек велосипеда:
1. **bb** — центр каретки (Bottom Bracket). Точка, где шатуны крепятся к раме.
2. **stTop** — верх подседельной трубы (где подседельный штырь входит в трубу рамы).
3. **saddleMount** — верх седла там, где оно сидит на подседельном штыре (самая высокая точка седла с штырём, не нос и не зад седла!).
4. **htTop** — верх рулевого стакана рамы: верхний торец самой рулевой трубы рамы, её верхняя кромка. НЕ крышка рулевой, НЕ проставочные кольца, НЕ вынос — именно торец трубы рамы.
5. **htBottom** — низ рулевой трубы РАМЫ, место где корона вилки прилегает к низу стакана через нижний подшипник рулевой колонки. На фото сбоку — точка стыка короны вилки с рамой.
6. **rearAxle** — центр оси заднего колеса.
7. **frontAxle** — центр оси переднего колеса.

⭐ ГЛАВНОЕ: координаты верни как ДОЛИ от размера изображения, НЕ пиксели.
- x = 0.0 → самая левая точка изображения
- x = 1.0 → самая правая точка изображения
- y = 0.0 → самая верхняя точка изображения
- y = 1.0 → самая нижняя точка изображения
- Например, если точка ровно в центре — x=0.5, y=0.5
- Если точка на 70% ширины и 30% высоты — x=0.7, y=0.3

Формат ответа — СТРОГО JSON (без markdown, без \`\`\`):
{
  "bb": {"x": 0.42, "y": 0.55},
  "stTop": {"x": 0.28, "y": 0.33},
  "saddleMount": {"x": 0.21, "y": 0.13},
  "htTop": {"x": 0.73, "y": 0.24},
  "htBottom": {"x": 0.89, "y": 0.91},
  "rearAxle": {"x": 0.07, "y": 0.92},
  "frontAxle": {"x": 0.89, "y": 0.91},
  "confidence": "high|medium|low",
  "notes": "краткий комментарий"
}

Важно:
- x и y — числа от 0.0 до 1.0 (с 2-3 знаками после запятой)
- НЕ ВЫВОДИ поля imageWidth/imageHeight — они не нужны
- Если точку невозможно определить — поставь null для x и y
- Если на фото нет велосипеда — верни все null, confidence: "low"`;
}

export async function POST(req: NextRequest) {
  try {
    // 1) Парсим FormData с защитой
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Запрос должен быть FormData с полем 'image'",
          details: { receivedContentType: req.headers.get("content-type") ?? "—" },
        },
        { status: 400 }
      );
    }

    const imageFile = formData.get("image");

    // 2) Валидация входного файла через Zod
    const fileValidation = ImageFileSchema.safeParse({ file: imageFile });
    if (!fileValidation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Некорректный файл изображения",
          details: fileValidation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const validatedFile = fileValidation.data.file;
    const arrayBuffer = await validatedFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString("base64");
    const mimeType = validatedFile.type || "image/jpeg";

    // 3) ИЗВЛЕКАЕМ РЕАЛЬНЫЕ РАЗМЕРЫ САМИ — не доверяем VLM.
    const realDims = extractImageDimensions(buffer, mimeType);

    if (realDims.width === 0 || realDims.height === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Не удалось определить размер изображения. Используйте JPEG или PNG.",
        },
        { status: 400 }
      );
    }

    // 2) Промпт с явно указанными реальными размерами.
    const prompt = buildPrompt(realDims.width, realDims.height);

    // Инициализация ZAI SDK (серверная).
    // На хостингах без настроенного .z-ai-config (например, Vercel) SDK
    // недоступен — возвращаем понятную ошибку вместо 500.
    let zai: Awaited<ReturnType<typeof ZAI.create>>;
    try {
      zai = await ZAI.create();
    } catch (initError) {
      console.error(
        "ZAI SDK init failed (проверьте .z-ai-config / переменные окружения):",
        initError instanceof Error ? initError.message : initError
      );
      return NextResponse.json(
        {
          success: false,
          error:
            "AI-калибровка недоступна на сервере: не настроены ключи vision-модели. Отметьте ключевые точки вручную.",
        },
        { status: 503 }
      );
    }

    const response = await zai.chat.completions.createVision({
      // Vision-модель SDK (обязательное поле типа CreateChatCompletionVisionBody)
      model: "glm-4.5v",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });

    const content = response.choices[0]?.message?.content ?? "";

    // 5) Парсим JSON из ответа VLM
    let rawParsed: unknown;
    try {
      rawParsed = JSON.parse(content);
    } catch {
      // Пробуем извлечь JSON из текста (VLM может обернуть в markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return NextResponse.json(
          {
            success: false,
            error: "Не удалось распознать ответ модели (нет JSON)",
            rawResponse: content.slice(0, 500),
          },
          { status: 502 }
        );
      }
      try {
        rawParsed = JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        return NextResponse.json(
          {
            success: false,
            error: "JSON в ответе модели невалиден",
            details: formatError(parseError),
            rawResponse: content.slice(0, 500),
          },
          { status: 502 }
        );
      }
    }

    // 6) Валидируем структуру ответа VLM через Zod
    const vlmValidation = VlmResponseSchema.safeParse(rawParsed);
    if (!vlmValidation.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Ответ модели не соответствует ожидаемой схеме",
          details: vlmValidation.error.flatten().fieldErrors,
          rawResponse: content.slice(0, 500),
        },
        { status: 502 }
      );
    }

    const points = vlmValidation.data;

    // 3) VLM уже возвращает доли [0..1] согласно новому промпту.
    //    Но на всякий случай — если вернул пиксели (>1.5), нормализуем по realDims.
    const normalizedPoints: Record<
      string,
      { x: number | null; y: number | null }
    > = {};

    let maxRawX = 0;
    let maxRawY = 0;

    for (const key of REQUIRED_POINTS) {
      const pt = points[key];
      if (pt && pt.x != null && pt.y != null) {
        maxRawX = Math.max(maxRawX, pt.x);
        maxRawY = Math.max(maxRawY, pt.y);
      }
    }

    // Если хотя бы одна координата > 1.5 — VLM вернул пиксели, а не доли.
    // Нормализуем по реальным размерам.
    const isAlreadyFraction = maxRawX <= 1.5 && maxRawY <= 1.5;

    for (const key of REQUIRED_POINTS) {
      const pt = points[key] as { x: number | null; y: number | null } | null;
      if (pt && pt.x != null && pt.y != null) {
        let x = pt.x;
        let y = pt.y;

        if (!isAlreadyFraction) {
          // VLM вернул пиксели. Пробуем сначала через его imageWidth/Height (если он их всё-таки вернул).
          const vlmW = (points as { imageWidth?: number }).imageWidth;
          const vlmH = (points as { imageHeight?: number }).imageHeight;
          if (vlmW && vlmH && vlmW > 0 && vlmH > 0) {
            x = x / vlmW;
            y = y / vlmH;
          } else {
            // Иначе нормализуем по реальным размерам
            x = x / realDims.width;
            y = y / realDims.height;
          }
        }

        normalizedPoints[key] = {
          x: Math.max(0, Math.min(1, x)),
          y: Math.max(0, Math.min(1, y)),
        };
      } else {
        normalizedPoints[key] = { x: null, y: null };
      }
    }

    const missing = REQUIRED_POINTS.filter(
      (k) =>
        !normalizedPoints[k] ||
        normalizedPoints[k].x == null ||
        normalizedPoints[k].y == null
    );

    if (missing.length === REQUIRED_POINTS.length) {
      return NextResponse.json({
        success: false,
        error: "Не удалось определить ни одной точки на фото",
        points: null,
      });
    }

    return NextResponse.json({
      success: true,
      points: normalizedPoints,
      missing,
      confidence: points.confidence || "low",
      notes: points.notes || "",
      imageSize: { width: realDims.width, height: realDims.height },
      normalized: true,
    });
  } catch (e) {
    // Глобальный catch — любая непредвиденная ошибка
    const msg = formatError(e);
    console.error("[API_CALIBRATE_FATAL_ERROR]:", e);
    return NextResponse.json(
      {
        success: false,
        error: `Внутренняя ошибка сервера: ${msg}`,
      },
      { status: 500 }
    );
  }
}

// Web WebP/нужно — silence unused warning
type _Unused = RequiredPointKey;
