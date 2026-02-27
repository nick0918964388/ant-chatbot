import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 聊天助手",
  description: "基於 Ant Design X 的聊天機器人",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
