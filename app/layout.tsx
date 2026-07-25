import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "@/lib/AuthContext";
import MeshBackground from "@/components/ui/MeshBackground";
import OfflineBanner from "@/components/ui/OfflineBanner";
import AnalyticsProvider from "@/components/ui/AnalyticsProvider";
import OptOutAwareAnalytics from "@/components/ui/OptOutAwareAnalytics";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WMNY Shift Swap",
  description: "Peer-to-peer shift swap platform for NYC MTA bus operators",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "WMNY Shift Swap",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="icon" type="image/png" href="/icons/icon-192.png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="theme-color" content="#010028" />
      </head>
      <body className={poppins.className}>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-RJV2G8G06H"
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          try { if (window.localStorage.getItem('wmny-analytics-optout') === '1') { window['ga-disable-G-RJV2G8G06H'] = true; } } catch (e) {}
          gtag('js', new Date());
          gtag('config', 'G-RJV2G8G06H');
        `}</Script>
        <MeshBackground />
        <header>
          <a href="#main-content" className="skip-link">Skip to main content</a>
          <OfflineBanner />
        </header>
        <AuthProvider>
          <AnalyticsProvider>
            <div style={{ position: "relative", zIndex: 1 }}>
              {children}
            </div>
          </AnalyticsProvider>
        </AuthProvider>
        <OptOutAwareAnalytics />
      </body>
    </html>
  );
}
