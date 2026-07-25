"use client";

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { isAnalyticsOptedOut } from "@/lib/analytics";

// Gate BOTH Vercel Web Analytics and Speed Insights on the per-device opt-out
// via their beforeSend hooks. This is the live, per-event guarantee: opted-out
// users send nothing from the very first event, with no effect/state (so no
// hydration mismatch) and nothing to short-circuit after mount.
export default function OptOutAwareAnalytics() {
  return (
    <>
      <Analytics beforeSend={(event) => (isAnalyticsOptedOut() ? null : event)} />
      <SpeedInsights beforeSend={(event) => (isAnalyticsOptedOut() ? null : event)} />
    </>
  );
}
