import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Newsreader, Fira_Code } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader" });
const fira = Fira_Code({ subsets: ["latin"], variable: "--font-fira" });

export const metadata: Metadata = {
  title: "Contract Analyser",
  description: "Ask questions about a contract. Every answer is backed by quotes checked against the document.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${newsreader.variable} ${fira.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
