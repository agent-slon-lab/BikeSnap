"use client";

/**
 * v1.14.41: точка монтирования sync-моста (syncBridge.ts).
 *
 * Один раз за загрузку страницы тянет снапшот велов/райдеров со «второй
 * половины» приложения (vercel ↔ зеркало) через скрытый iframe. На
 * недоступном peer тихо отступает (vercel заблокирован без VPN — норма).
 * При реальном добавлении записей — тост (данные появятся в списках
 * после навигации/перезахода, актив принудительно не переключается).
 */

import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { startStorageSync } from "@/lib/syncBridge";

export default function SyncBridgeInit() {
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    startStorageSync().then((res) => {
      if (cancelled || !res.ok) return;
      if (res.bikesAdded > 0 || res.ridersAdded > 0) {
        toast({
          title: "Данные синхронизированы",
          description: `С другого сайта добавлено: велов +${res.bikesAdded}, райдеров +${res.ridersAdded}.`,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  return null;
}
