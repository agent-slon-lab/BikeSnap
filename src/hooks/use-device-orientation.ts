import { useState, useEffect } from 'react';

export function useDeviceOrientation() {
  const [isLevel, setIsLevel] = useState<boolean>(false);
  const [pitch, setPitch] = useState<number>(0);

  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      const gamma = Math.abs(e.gamma || 0); // Наклон влево/вправо
      const beta = Math.abs(e.beta || 0);   // Наклон вперед/назад

      setPitch(beta);
      // Смартфон держится ровно, если боковой наклон < 3°, а вертикальный близко к 90°
      setIsLevel(gamma < 3 && beta > 80 && beta < 100);
    };

    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', handleOrientation);
    }

    return () => {
      if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
        window.removeEventListener('deviceorientation', handleOrientation);
      }
    };
  }, []);

  return { isLevel, pitch };
}
