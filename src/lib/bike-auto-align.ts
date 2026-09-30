/**
 * Автоматическое выравнивание геометрии рамы по горизонтальной оси колес.
 *
 * Если велосипед на фото стоит под наклоном (на подножке, на неровной поверхности),
 * оси колес не на одной горизонтальной линии. Это искажает все вертикальные размеры.
 *
 * Решение: поворот всех точек вокруг центра BB на угол -α, где α = угол наклона
 * линии между осями колес к горизонтали. После поворота оси становятся горизонтальными.
 *
 * Принцип:
 * 1. Вычисляем угол наклона: α = atan2(dy, dx) между rearAxle и frontAxle
 * 2. Поворачиваем все точки вокруг BB на угол -α
 * 3. BB остаётся на месте (точка вращения)
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface BikeKeyPoints {
  bb: Point2D;
  stTop: Point2D;
  saddleMount: Point2D;
  htTop: Point2D;
  htBottom: Point2D;
  htTopCap: Point2D;
  rearAxle: Point2D;
  frontAxle: Point2D;
}

/**
 * Автоматически выравнивает геометрию рамы по горизонтальной оси колес.
 *
 * @param points Ключевые точки (нормализованные [0..1])
 * @param imgSize Реальные размеры фото
 * @returns Новые точки с выровненными осями колёс
 */
export function autoAlignBikeHorizon(points: BikeKeyPoints, imgSize: ImageSize): BikeKeyPoints {
  const rear = points.rearAxle;
  const front = points.frontAxle;

  // Угол наклона линии между осями колес к горизонтали
  const dx = (front.x - rear.x) * imgSize.width;
  const dy = (front.y - rear.y) * imgSize.height;
  const angleRad = Math.atan2(dy, dx);

  // Поворот на -angleRad вокруг BB
  const pivot = points.bb;
  const cos = Math.cos(-angleRad);
  const sin = Math.sin(-angleRad);

  const rotatePoint = (p: Point2D): Point2D => {
    const px = (p.x - pivot.x) * imgSize.width;
    const py = (p.y - pivot.y) * imgSize.height;
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    return {
      x: rx / imgSize.width + pivot.x,
      y: ry / imgSize.height + pivot.y,
    };
  };

  return {
    bb: points.bb,
    stTop: rotatePoint(points.stTop),
    saddleMount: rotatePoint(points.saddleMount),
    htTop: rotatePoint(points.htTop),
    htBottom: rotatePoint(points.htBottom),
    htTopCap: rotatePoint(points.htTopCap),
    rearAxle: rotatePoint(points.rearAxle),
    frontAxle: rotatePoint(points.frontAxle),
  };
}
