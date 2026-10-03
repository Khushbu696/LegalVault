import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Newsreader, Fira_Code } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });
const fira = Fira_Code({ subsets: ["latin"], variable: "--font-fira" });

export const metadata: Metadata = {
  title: "Legal Vault",
  description: "AI-powered contract analysis with verified citations and document comparison.",
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${newsreader.variable} ${fira.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
