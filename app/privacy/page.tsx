"use client";

import { useRouter } from "next/navigation";
import { C } from "@/constants/colors";
import Icon from "@/components/ui/Icon";

const s = {
  page: { minHeight: "100vh", color: C.white } as React.CSSProperties,
  header: { position: "sticky" as const, top: 0, zIndex: 100, background: "rgba(1,0,40,.85)", backdropFilter: "blur(24px)", borderBottom: `1px solid ${C.bd}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 },
  content: { maxWidth: 680, margin: "0 auto", padding: "32px 24px 80px" },
  h1: { fontSize: 26, fontWeight: 800, color: C.white, marginBottom: 6 },
  updated: { fontSize: 12, color: C.m, marginBottom: 36 },
  section: { marginBottom: 32 },
  h2: { fontSize: 15, fontWeight: 700, color: C.gold, textTransform: "uppercase" as const, letterSpacing: 2, marginBottom: 12 },
  p: { fontSize: 14, color: "rgba(255,255,255,.75)", lineHeight: 1.8, marginBottom: 12 },
  li: { fontSize: 14, color: "rgba(255,255,255,.75)", lineHeight: 1.8, marginBottom: 6 },
  divider: { borderColor: C.bd, margin: "28px 0" },
};

export default function PrivacyPage() {
  const router = useRouter();
  return (
    <div style={s.page}>
      <div style={s.header}>
        <button onClick={() => router.back()} aria-label="Go back" style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon n="back" s={16} />
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.white }}>Privacy Policy</div>
      </div>

      <main id="main-content" tabIndex={-1} style={s.content}>
        <h1 style={s.h1}>Privacy Policy</h1>
        <p style={s.updated}>Last updated: July 25, 2026</p>

        <div style={s.section}>
          <h2 style={s.h2}>1. Overview</h2>
          <p style={s.p}>We Move New York ("WMNY," "we," "us") is committed to protecting your privacy. This Privacy Policy explains what information we collect, how we use it, and your rights regarding your data. By using the App, you agree to the practices described in this policy.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>2. Information We Collect</h2>
          <p style={s.p}><strong style={{ color: C.white }}>Account Information:</strong> When you register, we collect your name, email address, depot assignment, and a hashed (encrypted) password. We never store your password in plain text.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Swap Listings:</strong> Content you post — including shift details, run numbers, routes, and dates — is visible to other verified users at your depot.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Messages:</strong> Messages sent through the platform are stored to facilitate swap coordination. Messages are only visible to the sender and recipient.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Reputation & Reviews:</strong> Ratings and completion history are stored and displayed to other users to build trust in the platform.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Usage Data:</strong> We use Google Analytics and Google Tag Manager (Google services) to understand how the App is used. This collects which pages and screens you visit, which features you tap, your device and browser type, and an approximate location derived from your IP address. Google may also set its own cookies or identifiers as part of this. We do <strong style={{ color: C.white }}>not</strong> send Google the content of your messages, your identity-linked swap details, or your password. This usage data is never shared with your employer, the MTA, or any union, and is never sold. Google processes it under its own <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: C.gold }}>Privacy Policy</a>. You can turn analytics off at any time — see <strong style={{ color: C.white }}>Cookies &amp; Your Choices</strong> below.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Performance &amp; Traffic:</strong> We also use Vercel Web Analytics and Vercel Speed Insights (services provided by Vercel) to measure overall traffic and performance, such as page load times and Core Web Vitals. These are cookieless and anonymized. Vercel processes this data under its own <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: C.gold }}>Privacy Policy</a>. It is never shared with your employer, the MTA, or any union, and is never sold, and it is covered by the same opt-out described in <strong style={{ color: C.white }}>Cookies &amp; Your Choices</strong> below.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>3. How We Use Your Information</h2>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>To operate and maintain the swap coordination platform.</li>
            <li style={s.li}>To display your profile, reputation, and listings to other verified users.</li>
            <li style={s.li}>To send you messages from other operators about your swap posts.</li>
            <li style={s.li}>To enforce our Terms of Use and investigate reported content.</li>
            <li style={s.li}>To improve the App&apos;s features and user experience.</li>
          </ul>
          <p style={s.p}>We do not sell, rent, or share your personal information with third parties for marketing purposes.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>4. Who Can See Your Information</h2>
          <p style={s.p}><strong style={{ color: C.white }}>Other verified users</strong> can see your name, depot, swap listings, and reputation score.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Your contact information</strong> (phone number) is only visible if you choose to include it on a swap post.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Messages</strong> are private between sender and recipient only.</p>
          <p style={s.p}><strong style={{ color: C.white }}>Your email address</strong> is never displayed publicly on the platform.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>5. Data Security</h2>
          <p style={s.p}>We use industry-standard security measures including password hashing (bcrypt), JWT-based authentication with short-lived tokens, and encrypted database connections. While we work hard to protect your data, no method of transmission over the internet is 100% secure.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>6. Data Retention</h2>
          <p style={s.p}>We retain different categories of data for different periods:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}><strong style={{ color: C.white }}>Swap listings</strong> are automatically expired after 90 days of inactivity.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Messages</strong> between users are retained for as long as both user accounts remain active, or until a user deletes them.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Reputation and rating history</strong> is retained for the life of the account so that trust signals remain available to other users.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Block records</strong> are retained for the life of both accounts to ensure block enforcement remains active.</li>
            <li style={s.li}><strong style={{ color: C.white }}>Audit logs</strong> of sensitive actions (login attempts, account changes, reports) are retained for up to 12 months for security and abuse prevention.</li>
          </ul>
          <p style={s.p}>When you request deletion of your account, your profile, swap listings, and personally identifying information are removed within 30 days. Some data (such as audit logs and certain records of reported or terminated accounts) may be retained longer to prevent abuse and as required by applicable law.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>7. Cookies &amp; Your Choices</h2>
          <p style={s.p}>We use secure login cookies to maintain your session — these are set by our servers and are not accessible to browser scripts, which protects your login from common web attacks.</p>
          <p style={s.p}>Our analytics tools (Google Analytics and Google Tag Manager) may set their own cookies or identifiers to measure how the App is used. You can opt out of this at any time:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>Turn off <strong style={{ color: C.white }}>Share anonymous usage analytics</strong> in your Profile — this stops analytics from that device immediately.</li>
            <li style={s.li}>Install Google&apos;s <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" style={{ color: C.gold }}>Analytics Opt-out Browser Add-on</a> to block Google Analytics across all sites.</li>
            <li style={s.li}>Enable <strong style={{ color: C.white }}>Do Not Track</strong>, block cookies, or use your browser&apos;s private / incognito mode.</li>
          </ul>
          <p style={s.p}>Opting out of analytics does not affect your ability to post, claim, or message about swaps — the App works exactly the same.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>8. Your Rights</h2>
          <p style={s.p}>You have the right to:</p>
          <ul style={{ listStyle: "disc", paddingLeft: 24, marginBottom: 12 }}>
            <li style={s.li}>Access and update your personal information via your Profile page.</li>
            <li style={s.li}>Delete your swap posts at any time.</li>
            <li style={s.li}>Request deletion of your account and all associated data.</li>
            <li style={s.li}>Opt out of non-essential communications.</li>
            <li style={s.li}>Opt out of analytics tracking (see Section 7 for how).</li>
          </ul>
          <p style={s.p}>To exercise any of these rights, email us at wemovenewyork.net@gmail.com or contact us through the app.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>9. Changes to This Policy</h2>
          <p style={s.p}>We may update this Privacy Policy from time to time. We will notify users of material changes through the App. Continued use after changes are posted means you accept the updated policy.</p>
        </div>

        <hr style={s.divider} />

        <div style={s.section}>
          <h2 style={s.h2}>10. Contact</h2>
          <p style={s.p}>For privacy-related questions, data access requests, or account deletion requests, you can reach us at wemovenewyork.net@gmail.com or through the app.</p>
        </div>
      </main>
    </div>
  );
}
