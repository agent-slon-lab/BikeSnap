import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BikeSnap — Анализ посадки на велосипеде",
  description:
    "AI-анализ посадки велосипедиста по видео: расчёт углов колена, бедра, спины и рекомендаций по настройке седла и руля. На базе MediaPipe Pose.",
  keywords: [
    "велосипед",
    "байкфит",
    "bike fit",
    "посадка",
    "MediaPipe",
    "pose estimation",
    "велофиттинг",
  ],
  authors: [{ name: "BikeSnap" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "BikeSnap",
    description: "Анализ посадки на велосипеде с помощью AI",
    siteName: "BikeSnap",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
