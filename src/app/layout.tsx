import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whole Hearted 正式管理系统",
  description: "Whole Hearted Car Service Limited 正式业务管理系统",
  icons: {
    icon: "/brand-logo-wh-512.png",
    shortcut: "/brand-logo-wh-512.png",
    apple: "/brand-logo-wh-512.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
