"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { Depot } from "@/types";
import { C } from "@/constants/colors";
import Icon from "@/components/ui/Icon";
import RepBadge from "@/components/ui/RepBadge";
import DepotBadge from "@/components/ui/DepotBadge";
import Toast from "@/components/ui/Toast";
import NotifToggle from "@/components/ui/NotifToggle";
import InboxIcon from "@/components/ui/InboxIcon";
import NotifIcon from "@/components/ui/NotifIcon";
import { analytics, isAnalyticsOptedOut, setAnalyticsOptedOut } from "@/lib/analytics";
import { useT } from "@/lib/i18n";
import CountUp from "@/components/ui/CountUp";
import ProgressRing from "@/components/ui/ProgressRing";

const lb: React.CSSProperties = { display: "block", marginBottom: 8, fontSize: 12, fontWeight: 600, color: C.m, letterSpacing: 2, textTransform: "uppercase" };

// A7: server-backed per-category prefs (replaces the old localStorage-only
// stub, which nothing ever read).
interface NotifSettings {
  prefs: {
    new_post: "all" | "matches" | "digest" | "off";
    message: boolean;
    agreement: boolean;
    swap_updates: boolean;
    announcements: boolean;
    digest: boolean;
  };
  quietStart: string | null;
  quietEnd: string | null;
}
function PillToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!on)} style={{ width: 44, height: 24, borderRadius: 12, background: on ? C.gold : "rgba(255,255,255,.06)", transition: "background .2s", cursor: "pointer", position: "relative", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: on ? C.bg : "rgba(255,255,255,.4)", transition: "left .2s" }} />
    </div>
  );
}

export default function ProfilePage() {
  const { user, logout, updateUser, loading, refreshUser } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"profile" | "security">("profile");
  const [fn, setFn] = useState(""); const [ln, setLn] = useState(""); const [email, setEmail] = useState(""); const [lang, setLang] = useState("en"); const [depotId, setDepotId] = useState("");
  const [curPw, setCurPw] = useState(""); const [newPw, setNewPw] = useState(""); const [newPw2, setNewPw2] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePw, setDeletePw] = useState(""); const [deleteErr, setDeleteErr] = useState(""); const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null); const [pwErr, setPwErr] = useState("");
  const [depots, setDepots] = useState<Depot[]>([]); const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [notifSettings, setNotifSettings] = useState<NotifSettings | null>(null);
  const [analyticsOn, setAnalyticsOn] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); }, []);
  const tt = useT(user?.language);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (user) { setFn(user.firstName); setLn(user.lastName); setEmail(user.email); setLang(user.language || "en"); setDepotId(user.depotId ?? ""); }
    api.get<Depot[]>("/depots").then(setDepots).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.get<NotifSettings>("/users/me/notification-prefs").then(setNotifSettings).catch(() => {});
  }, [user]);

  useEffect(() => {
    setAnalyticsOn(!isAnalyticsOptedOut());
  }, []);

  const savePrefs = async (patch: Partial<NotifSettings["prefs"]>) => {
    if (!notifSettings) return;
    // Optimistic update; server response is authoritative.
    setNotifSettings({ ...notifSettings, prefs: { ...notifSettings.prefs, ...patch } });
    try {
      const updated = await api.put<NotifSettings>("/users/me/notification-prefs", { prefs: patch });
      setNotifSettings(updated);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Save failed");
      api.get<NotifSettings>("/users/me/notification-prefs").then(setNotifSettings).catch(() => {});
    }
  };

  const saveQuietHours = async (quietStart: string | null, quietEnd: string | null) => {
    if (!notifSettings) return;
    setNotifSettings({ ...notifSettings, quietStart, quietEnd });
    try {
      const updated = await api.put<NotifSettings>("/users/me/notification-prefs", { quietStart, quietEnd });
      setNotifSettings(updated);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Save failed");
      api.get<NotifSettings>("/users/me/notification-prefs").then(setNotifSettings).catch(() => {});
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAvatarUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = 128; canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      const size = Math.min(bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 128, 128);
      bitmap.close();
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      await api.put("/users/me", { avatarUrl: dataUrl });
      await refreshUser();
      analytics.avatarUploaded();
      showToast("Photo updated");
    } catch (err) {
      console.error("[avatar upload]", err);
      showToast("Failed to upload photo — try a JPEG or PNG");
    }
    setAvatarUploading(false);
  };

  const handleLogoutAll = async () => {
    try {
      await api.post("/auth/logout-all", {});
      logout();
      router.replace("/login");
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Failed"); }
  };

  const handleDownload = async () => {
    try {
      const data = await api.get<unknown>("/users/me/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "my-wmny-data.json"; a.click();
      URL.revokeObjectURL(url);
      analytics.dataDownloaded();
    } catch (e: unknown) {
      console.error("Export failed", e);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const data = await api.put("/users/me", { firstName: fn, lastName: ln, email, language: lang, depotId });
      updateUser(data as Parameters<typeof updateUser>[0]);
      showToast("Saved!");
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : "Save failed"); }
    setSaving(false);
  };

  const changePassword = async () => {
    setPwErr("");
    if (!curPw || !newPw || !newPw2) { setPwErr("Fill in all fields"); return; }
    if (newPw.length < 12) { setPwErr("Min 12 characters"); return; }
    if (newPw !== newPw2) { setPwErr("Passwords do not match"); return; }
    try {
      await api.put("/auth/password", { currentPassword: curPw, newPassword: newPw });
      setCurPw(""); setNewPw(""); setNewPw2("");
      showToast("Password updated!");
    } catch (e: unknown) { setPwErr(e instanceof Error ? e.message : "Failed"); }
  };

  const handleLogout = () => { logout(); router.replace("/login"); };

  if (!user) return null;
  const depot = user.depot ?? depots.find(d => d.id === user.depotId) ?? null;

  const depotLocked = (() => {
    if (!user.depotId) return false;
    if (user.role === "admin" || user.role === "subAdmin") return false;
    if (!user.depotSetAt) return false;
    return (Date.now() - new Date(user.depotSetAt).getTime()) < 7 * 24 * 60 * 60 * 1000;
  })();
  const depotUnlocksAt = user.depotSetAt
    ? new Date(new Date(user.depotSetAt).getTime() + 7 * 24 * 60 * 60 * 1000)
    : null;

  return (
    <div style={{ minHeight: "100vh", background: C.bg }}>
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(1,0,40,.8)", backdropFilter: "blur(24px)", borderBottom: "1px solid rgba(255,255,255,.06)", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push(user?.depot?.code ? `/depot/${user.depot.code}` : "/depots")} aria-label="Go back" style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.bd}`, background: C.s, color: C.gold, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon n="back" s={16} /></button>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.white }}>My Profile</div>
        <NotifIcon />
        <InboxIcon />
      </div>

      <main id="main-content" tabIndex={-1} style={{ maxWidth: 440, margin: "0 auto", padding: "24px 20px 80px" }}>
        {/* Avatar */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            onClick={() => fileInputRef.current?.click()}
            title="Change avatar"
            style={{ width: 90, height: 90, borderRadius: "50%", background: `linear-gradient(135deg,${C.navy},${C.blue})`, display: "inline-flex", alignItems: "center", justifyContent: "center", border: `3px solid ${C.gold}`, marginBottom: 12, boxShadow: `0 0 24px ${C.gold}22`, cursor: "pointer", position: "relative", overflow: "hidden" }}
          >
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="Avatar" width={90} height={90} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
            ) : (
              <span style={{ fontSize: 32, fontWeight: 800, color: C.gold }}>{fn.charAt(0)}{ln.charAt(0)}</span>
            )}
            {avatarUploading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "50%" }}>
                <div style={{ width: 24, height: 24, border: `3px solid ${C.gold}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarChange} />
          <div style={{ fontSize: 20, fontWeight: 800, color: C.white }}>{fn} {ln}</div>
          <div style={{ fontSize: 12, color: C.m, marginTop: 4 }}>{email}</div>
          <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 8 }}>
            {(user.reputation?.total ?? 0) > 0 && <ProgressRing score={user.reputation?.score ?? 0} size={48} strokeWidth={4} />}
            <RepBadge rep={user.reputation} size="small" />
          </div>
          {depot && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, padding: "4px 12px", borderRadius: 8, background: C.s, border: `1px solid ${C.bd}` }}>
              <DepotBadge depot={depot} size={20} />
              <span style={{ fontSize: 11, color: C.gold, fontWeight: 600 }}>{depot.name}</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, background: C.s, borderRadius: 12, padding: 4, marginBottom: 20 }}>
          {(["profile", "security"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: 10, borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t ? C.gold : "transparent", color: tab === t ? C.bg : C.m }}>
              {t === "profile" ? "Profile" : "Security"}
            </button>
          ))}
        </div>

        {tab === "profile" ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><label htmlFor="prof-fn" style={lb}>First Name</label><input id="prof-fn" value={fn} onChange={e => setFn(e.target.value)} /></div>
              <div><label htmlFor="prof-ln" style={lb}>Last Name</label><input id="prof-ln" value={ln} onChange={e => setLn(e.target.value)} /></div>
            </div>
            <div><label htmlFor="prof-email" style={lb}>Email Address</label><input id="prof-email" type="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
            <div>
              <label htmlFor="prof-lang" style={lb}>Language</label>
              <select
                id="prof-lang"
                value={lang}
                onChange={e => setLang(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${C.bd}`,
                  background: C.s,
                  color: C.white,
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="zh">中文</option>
                <option value="ht">Kreyòl</option>
              </select>
              <div style={{ fontSize: 11, color: C.m, marginTop: 6 }}>
                Changes apply when you tap Save.
              </div>
            </div>
            <div>
              <label htmlFor="prof-depot" style={lb}>Home Depot</label>
              <select
                id="prof-depot"
                value={depotId}
                onChange={e => setDepotId(e.target.value)}
                disabled={depotLocked}
                style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1px solid ${C.bd}`, background: C.s, color: depotId ? C.white : C.m, fontSize: 14, cursor: depotLocked ? "not-allowed" : "pointer", appearance: "auto", opacity: depotLocked ? 0.6 : 1 }}
              >
                <option value="">— Select your home depot —</option>
                {["Manhattan","Brooklyn","Bronx","Queens","Staten Island"].map(borough => {
                  const bd = depots.filter(d => d.borough === borough);
                  if (!bd.length) return null;
                  return (
                    <optgroup key={borough} label={borough}>
                      {bd.map(d => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
                    </optgroup>
                  );
                })}
              </select>
              {depotLocked && (
                <div style={{ fontSize: 11, color: C.gold, marginTop: 6, lineHeight: 1.5 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",verticalAlign:"middle",marginRight:4}}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                  {depotUnlocksAt ? `Locked until ${depotUnlocksAt.toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : "Locked"}
                </div>
              )}
            </div>
            <button onClick={saveProfile} disabled={saving} style={{ padding: 16, borderRadius: 14, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${C.gold},${C.gold}dd)`, fontSize: 15, fontWeight: 700, color: C.bg }}>
              {saving ? "Saving..." : "Save Changes"}
            </button>

            {/* Invite codes */}
            <div style={{ marginTop: 8, background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 16, border: "1px solid " + C.bd }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2 }}>My Invite Codes</div>
                <div style={{ fontSize: 10, color: C.m }}>{(user.inviteCodes ?? []).filter(c => c.isValid).length} remaining</div>
              </div>
              <div style={{ fontSize: 11, color: C.m, lineHeight: 1.6, marginBottom: 12 }}>
                To protect the integrity of this site, invite codes must only be shared with verified bus operators. Under no circumstances are invite codes to be distributed to anyone who is not authorized to access this site.
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {(user.inviteCodes ?? []).map(cd => (
                  <div key={cd.code} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, background: !cd.isValid ? "rgba(255,255,255,.02)" : C.gold + "08", border: "1px solid " + (!cd.isValid ? C.bd : C.gold + "22") }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: !cd.isValid ? C.m : C.white, letterSpacing: 2, textDecoration: !cd.isValid ? "line-through" : "none" }}>{cd.code}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, color: !cd.isValid ? C.m : "#2ED573", textTransform: "uppercase", letterSpacing: 1 }}>{!cd.isValid ? "Used" : "Active"}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 8 }}><RepBadge rep={user.reputation} size="full" /></div>

            {/* Push Notifications */}
            <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 14, border: `1px solid ${C.bd}` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2 }}>Notifications</div>
                <button
                  onClick={() => router.push("/notifications")}
                  style={{ background: "none", border: `1px solid ${C.bd}`, borderRadius: 8, padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: 600, color: C.m, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Icon n="bell" s={12} c={C.m} />
                  View all
                </button>
              </div>
              <NotifToggle />
            </div>

            {/* A7: per-category notification preferences (server-backed) */}
            {notifSettings && (
              <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 14, border: `1px solid ${C.bd}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2, marginBottom: 6 }}>{tt("notif.title")}</div>
                <div style={{ fontSize: 11, color: C.m, lineHeight: 1.5, marginBottom: 12 }}>
                  {tt("notif.hint")}
                </div>

                {/* new_post: 4-way mode */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, color: C.white, marginBottom: 8 }}>{tt("notif.newPost")}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                    {([
                      { mode: "all" as const, label: tt("notif.mode.all") },
                      { mode: "matches" as const, label: tt("notif.mode.matches") },
                      { mode: "digest" as const, label: tt("notif.mode.digest") },
                      { mode: "off" as const, label: tt("notif.mode.off") },
                    ]).map(({ mode, label }) => {
                      const active = notifSettings.prefs.new_post === mode;
                      return (
                        <button
                          key={mode}
                          onClick={() => savePrefs({ new_post: mode })}
                          style={{ padding: "8px 4px", borderRadius: 10, border: `1px solid ${active ? C.gold : C.bd}`, background: active ? `${C.gold}18` : "rgba(255,255,255,.03)", cursor: "pointer", fontSize: 11, fontWeight: active ? 700 : 500, color: active ? C.gold : C.m }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Boolean categories */}
                <div style={{ display: "grid", gap: 12 }}>
                  {([
                    { key: "message" as const, label: tt("notif.cat.message") },
                    { key: "agreement" as const, label: tt("notif.cat.agreement") },
                    { key: "swap_updates" as const, label: tt("notif.cat.swap_updates") },
                    { key: "announcements" as const, label: tt("notif.cat.announcements") },
                    { key: "digest" as const, label: tt("notif.cat.digest") },
                  ]).map(({ key, label }) => (
                    <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                      <span style={{ fontSize: 13, color: C.white, lineHeight: 1.4 }}>{label}</span>
                      <PillToggle on={notifSettings.prefs[key]} onChange={v => savePrefs({ [key]: v })} />
                    </div>
                  ))}
                </div>

                {/* Quiet hours */}
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.bd}` }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: C.white }}>{tt("notif.quiet")}</span>
                    {notifSettings.quietStart && (
                      <button onClick={() => saveQuietHours(null, null)} style={{ background: "none", border: `1px solid ${C.bd}`, borderRadius: 8, padding: "3px 10px", cursor: "pointer", fontSize: 10, fontWeight: 600, color: C.m }}>
                        {tt("notif.quietClear")}
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="time"
                      aria-label="Quiet hours start"
                      value={notifSettings.quietStart ?? ""}
                      onChange={e => { const v = e.target.value; if (v) saveQuietHours(v, notifSettings.quietEnd ?? "07:00"); }}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.04)", color: C.white, fontSize: 13, colorScheme: "dark" }}
                    />
                    <span style={{ fontSize: 12, color: C.m }}>{tt("notif.quietTo")}</span>
                    <input
                      type="time"
                      aria-label="Quiet hours end"
                      value={notifSettings.quietEnd ?? ""}
                      onChange={e => { const v = e.target.value; if (v) saveQuietHours(notifSettings.quietStart ?? "22:00", v); }}
                      style={{ flex: 1, padding: "8px 10px", borderRadius: 10, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.04)", color: C.white, fontSize: 13, colorScheme: "dark" }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <div><label htmlFor="sec-curpw" style={lb}>Current Password</label><input id="sec-curpw" type="password" value={curPw} onChange={e => { setCurPw(e.target.value); setPwErr(""); }} placeholder="Enter current password" /></div>
            <div><label htmlFor="sec-newpw" style={lb}>New Password</label><input id="sec-newpw" type="password" value={newPw} onChange={e => { setNewPw(e.target.value); setPwErr(""); }} placeholder="Min 12 characters" /></div>
            <div><label htmlFor="sec-newpw2" style={lb}>Confirm New Password</label><input id="sec-newpw2" type="password" value={newPw2} onChange={e => { setNewPw2(e.target.value); setPwErr(""); }} placeholder="Re-enter new password" /></div>
            {pwErr && <div role="alert" aria-live="assertive" style={{ padding: "10px 14px", borderRadius: 12, background: C.red + "15", border: `1px solid ${C.red}33`, fontSize: 13, color: C.red }}>{pwErr}</div>}
            <button onClick={changePassword} style={{ padding: 16, borderRadius: 14, border: "none", cursor: "pointer", background: `linear-gradient(135deg,${C.gold},${C.gold}dd)`, fontSize: 15, fontWeight: 700, color: C.bg }}>Update Password</button>

            {/* Log out all devices */}
            <div style={{ background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 14, border: `1px solid ${C.bd}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.m, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>Device Sessions</div>
              <div style={{ fontSize: 12, color: C.m, lineHeight: 1.5, marginBottom: 10 }}>
                Signing out of all devices will invalidate all active sessions immediately.
              </div>
              <button
                onClick={handleLogoutAll}
                style={{ padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.red}33`, background: C.red + "12", cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.red, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <Icon n="out" s={14} c={C.red} /> Log Out All Devices
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 20, background: "rgba(255,255,255,.03)", borderRadius: 14, padding: 14, border: `1px solid ${C.bd}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.gold, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>Privacy</div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.white, marginBottom: 4 }}>Share anonymous usage analytics</div>
              <div style={{ fontSize: 12, color: C.m, lineHeight: 1.5 }}>Helps us improve the app. Never shared with your employer, the MTA, or any union. Turning this off stops analytics from this device.</div>
            </div>
            <PillToggle
              on={analyticsOn}
              onChange={(v) => {
                setAnalyticsOn(v);
                setAnalyticsOptedOut(!v);
                showToast(v ? "Analytics on" : "Analytics off — nothing is tracked from this device");
              }}
            />
          </div>
        </div>

        <button
          onClick={() => router.push("/help")}
          style={{ marginTop: 10, padding: 16, borderRadius: 14, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.04)", cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.m, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%" }}
        >
          <Icon n="inf" s={16} c={C.m} /> Help &amp; FAQ
        </button>

        <button
          onClick={handleDownload}
          style={{ marginTop: 10, padding: 16, borderRadius: 14, border: `1px solid ${C.bd}`, background: "rgba(255,255,255,.04)", cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.m, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%" }}
        >
          <Icon n="dl" s={16} c={C.m} /> Download My Data
        </button>

        <button onClick={handleLogout} style={{ marginTop: 10, padding: 16, borderRadius: 14, border: `1px solid ${C.red}33`, background: C.red + "12", cursor: "pointer", fontSize: 15, fontWeight: 600, color: C.red, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%" }}>
          <Icon n="out" s={16} c={C.red} /> Sign Out
        </button>

        {/* Delete Account */}
        <div style={{ marginTop: 32, padding: "16px", borderRadius: 14, border: `1px solid ${C.red}22`, background: C.red + "08" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.red, textTransform: "uppercase", letterSpacing: 2, marginBottom: 8 }}>Danger Zone</div>
          {!showDeleteConfirm ? (
            <button onClick={() => setShowDeleteConfirm(true)} style={{ padding: "12px 16px", borderRadius: 12, border: `1px solid ${C.red}44`, background: "transparent", cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.red, width: "100%" }}>
              Delete My Account
            </button>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,.6)", lineHeight: 1.6, margin: 0 }}>
                This will permanently anonymize your account. Your swap history remains but your name and email will be removed. This cannot be undone.
              </p>
              <input type="password" value={deletePw} onChange={e => { setDeletePw(e.target.value); setDeleteErr(""); }} placeholder="Enter your password to confirm" style={{ borderColor: C.red + "44" }} />
              {deleteErr && <div style={{ fontSize: 12, color: C.red }}>{deleteErr}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button onClick={() => { setShowDeleteConfirm(false); setDeletePw(""); setDeleteErr(""); }} style={{ padding: 12, borderRadius: 12, border: `1px solid ${C.bd}`, background: C.s, cursor: "pointer", fontSize: 13, color: C.m }}>Cancel</button>
                <button
                  disabled={deleting || !deletePw}
                  onClick={async () => {
                    setDeleting(true); setDeleteErr("");
                    try {
                      await api.post("/users/me/delete", { password: deletePw });
                      logout();
                      router.replace("/login");
                    } catch (e: unknown) {
                      setDeleteErr(e instanceof Error ? e.message : "Failed");
                    } finally { setDeleting(false); }
                  }}
                  style={{ padding: 12, borderRadius: 12, border: "none", background: C.red, cursor: deleting || !deletePw ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 700, color: "#fff", opacity: deleting || !deletePw ? 0.6 : 1 }}
                >
                  {deleting ? "Deleting..." : "Delete Account"}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      {toast && <Toast message={toast} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
