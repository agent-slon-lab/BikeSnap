import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

/**
 * Анализ фотографии велосипеда сбоку для извлечения параметров геометрии.
 *
 * Использует VLM (Vision Language Model) для определения:
 * - Высота седла (saddleHeight) — от центра BB до верха седла
 * - Setback (SB) — горизонталь от BB до носа седла
 * - Длина выноса (stem) — от центра рулевой трубы до центра руля
 * - Длина шатуна (crank) — от центра BB до центра оси педали
 * - ETT (effective top tube) — горизонталь от ST top до HT top
 * - Reach — горизонталь от BB до центра рулевой трубы
 * - Stack — вертикаль от BB до центра рулевой трубы
 * - Wheel Height (WH) — от земли до оси колеса (радиус с покрышкой)
 * - BB Height (BBH) — от земли до центра каретки
 *
 * ВАЖНО: STA (угол подседельной трубы) и HTA (угол рулевой трубы) НЕЛЬЗЯ
 * определить по фото — это требует точного знания центра BB и оси трубы.
 * Эти углы опциональны и не нужны для подгонки посадки.
 *
 * BB Drop вычисляется автоматически: BB Drop = Wheel Height − BB Height.
 *
 * Запрос: multipart/form-data с полем "image"
 * Ответ: JSON с параметрами и уверенностью модели
 */

interface BikePhotoParams {
  saddleHeight: number | null; // мм
  setback: number | null; // мм
  ett: number | null; // мм
  reach: number | null; // мм
  stack: number | null; // мм
  stem: number | null; // мм
  crank: number | null; // мм
  wheelHeight: number | null; // мм (радиус колеса с покрышкой)
  bbHeight: number | null; // мм (от земли до центра BB)
  confidence: "high" | "medium" | "low";
  notes: string;
}

const PROMPT = `Ты — эксперт по велосипедной геометрии. На изображении — велосипед сбоку.

Оцени по фотографии следующие параметры велосипеда. Все размеры — примерные,
на основе визуальной оценки.

1. **saddleHeight** (высота седла): расстояние от центра каретки (BB) до верха
   седла по прямой линии. Ответь в миллиметрах (например, 730).
2. **setback** (SB, сдвиг седла назад): горизонтальное расстояние от центра BB
   до носа седла. В миллиметрах (например, 55).
3. **ett** (effective top tube): горизонтальное расстояние от центра подседельной
   трубы до центра рулевой трубы. В миллиметрах (например, 545).
4. **reach**: горизонтальное расстояние от центра каретки до центра рулевой
   трубы. В миллиметрах (например, 380).
5. **stack**: вертикальное расстояние от центра каретки до центра рулевой
   трубы. В миллиметрах (например, 545).
6. **stem** (длина выноса): от центра рулевой трубы до центра руля. В миллиметрах
   (например, 100).
7. **crank** (длина шатуна): от центра каретки до центра оси педали. В миллиметрах
   (например, 172.5).
8. **wheelHeight** (WH): вертикальное расстояние от земли до центра оси колеса
   (радиус колеса с покрышкой). В миллиметрах (например, 335).
9. **bbHeight** (BBH): вертикальное расстояние от земли до центра каретки.
   В миллиметрах (например, 265).

ВНИМАНИЕ: НЕ пытайся определить углы (STA, HTA) — их невозможно точно оценить
по фото. Они опциональны и не нужны для подгонки посадки.

Также укажи:
- **confidence**: high / medium / low — насколько ты уверен в оценке, исходя из
  качества фото и угла съёмки
- **notes**: краткий комментарий о фото (например, "отличный вид сбоку, чёткое
  изображение" или "ракурс немного искажён, оценки приблизительные")

Ответ СТРОГО в формате JSON без markdown, без пояснений. Формат:
{
  "saddleHeight": 730,
  "setback": 55,
  "ett": 545,
  "reach": 380,
  "stack": 545,
  "stem": 100,
  "crank": 172.5,
  "wheelHeight": 335,
  "bbHeight": 265,
  "confidence": "medium",
  "notes": "..."
}

Если параметр невозможно определить — поставь null.
Если на фото нет велосипеда или качество слишком низкое — верни все поля null,
confidence: "low", notes с пояснением проблемы.`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const imageFile = formData.get("image");

    if (!imageFile || !(imageFile instanceof File)) {
      return NextResponse.json(
        { error: "Изображение не предоставлено" },
        { status: 400 }
      );
    }

    // Проверка размера (до 20 МБ)
    if (imageFile.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Размер файла превышает 20 МБ" },
        { status: 400 }
      );
    }

    // Конвертация в base64
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString("base64");
    const mimeType = imageFile.type || "image/jpeg";

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
          error:
            "AI-анализ недоступен на сервере: не настроены ключи vision-модели. Введите параметры велосипеда вручную.",
        },
        { status: 503 }
      );
    }

    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: PROMPT,
            },
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

    // Извлечение JSON из ответа
    let params: BikePhotoParams;
    try {
      // Сначала пробуем прямой парсинг
      params = JSON.parse(content);
    } catch {
      // Иначе ищем JSON в тексте
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return NextResponse.json(
          {
            error: "Не удалось распознать ответ модели",
            rawResponse: content,
          },
          { status: 500 }
        );
      }
      params = JSON.parse(jsonMatch[0]);
    }

    // Валидация и нормализация типов
    const result: BikePhotoParams = {
      saddleHeight: typeof params.saddleHeight === "number" ? params.saddleHeight : null,
      setback: typeof params.setback === "number" ? params.setback : null,
      ett: typeof params.ett === "number" ? params.ett : null,
      reach: typeof params.reach === "number" ? params.reach : null,
      stack: typeof params.stack === "number" ? params.stack : null,
      stem: typeof params.stem === "number" ? params.stem : null,
      crank: typeof params.crank === "number" ? params.crank : null,
      wheelHeight: typeof params.wheelHeight === "number" ? params.wheelHeight : null,
      bbHeight: typeof params.bbHeight === "number" ? params.bbHeight : null,
      confidence: ["high", "medium", "low"].includes(params.confidence)
        ? params.confidence
        : "low",
      notes: typeof params.notes === "string" ? params.notes : "",
    };

    return NextResponse.json({
      success: true,
      params: result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Bike photo analysis error:", msg);
    return NextResponse.json(
      { error: `Внутренняя ошибка сервера: ${msg}` },
      { status: 500 }
    );
  }
}
