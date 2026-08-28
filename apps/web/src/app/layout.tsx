import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { LanguageProvider } from "@/lib/i18n/language";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whole Hearted Management System",
  description: "Whole Hearted automotive operations management system",
  icons: {
    icon: "/logo-icon.png",
    shortcut: "/logo-icon.png",
    apple: "/logo-icon.png",
  },
};

const noFlashScript = `
(function() {
  try {
    var mode = localStorage.getItem('wh_theme_mode');
    if (mode !== 'system' && mode !== 'light' && mode !== 'dark') {
      var t = localStorage.getItem('wh_theme');
      var source = localStorage.getItem('wh_theme_source');
      mode = source === 'user' && (t === 'light' || t === 'dark') ? t : 'system';
      localStorage.setItem('wh_theme_mode', mode);
      localStorage.removeItem('wh_theme_source');
    }
    var resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    localStorage.setItem('wh_theme', resolved);
    if (resolved === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = resolved;
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body>
        <LanguageProvider>
          <ThemeProvider>
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
