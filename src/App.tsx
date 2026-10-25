import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import QrScanner from "qr-scanner";
import Admin from "./Admin";
import Warden from "./Warden";
import Exceptions from "./Exceptions";
import Passkeys from "./Passkeys";
import { Gate } from "./Biometric";
import { Brand, Facade, Ring, Icon } from "./ui";

// The anon (publishable) key is safe in the browser: Row Level Security protects the data.
// NEVER put the service_role / secret key in this project.
// Staying signed in is fine: every time the app is opened, fingerprint or Face ID is asked again (see Biometric.tsx).
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export default function App() {
  const [session, setSession] = useState<any>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <main><p className="note">Loading...</p></main>;
  return <main>{session ? <Gate supabase={supabase}><Home user={session.user} /></Gate> : <Login />}</main>;
}

function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [cool, setCool] = useState(0);
  const clean = email.trim().toLowerCase();

  useEffect(() => {
    if (cool <= 0) return;
    const t = setTimeout(() => setCool(cool - 1), 1000);
    return () => clearTimeout(t);
  }, [cool]);

  async function sendCode() {
    if (!/^\S+@\S+\.\S+$/.test(clean)) return setMsg("Enter a valid email address.");
    setBusy(true);
    setMsg("");
    // The same message is shown every time, so this form cannot be used to find out who is registered.
    await supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } });
    setStep("code");
    setCool(60);
    setMsg("If this email is registered, a code is on its way. It can take a minute. Use the newest email.");
    setBusy(false);
  }

  async function verify() {
    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.verifyOtp({ email: clean, token: code.trim(), type: "email" });
    if (error) setMsg("That code is not right or has expired. Check the newest email, or request a new code.");
    setBusy(false);
  }

  const google = () => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });

  return (
    <div className="card">
      <Facade />
      <h1>HostelPulse</h1>
      <p className="note">Sign in with the email your warden registered for you. You will then confirm with your fingerprint or Face ID.</p>
      <button className="light" onClick={google}>Continue with Google</button>
      {step === "email" ? (
        <>
          <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button disabled={busy} onClick={sendCode}>Email me a code</button>
        </>
      ) : (
        <>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="Code from your email" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button disabled={busy || code.length < 6} onClick={verify}>Sign in</button>
          <button className="link" disabled={busy || cool > 0} onClick={sendCode}>
            {cool > 0 ? `Resend code in ${cool}s` : "Resend code"}
          </button>
          <button className="link" onClick={() => { setStep("email"); setCode(""); setMsg(""); setCool(0); }}>Use a different email</button>
        </>
      )}
      {msg && <p className="note">{msg}</p>}
      <p className="note">HostelPulse lets hostel residents confirm their nightly attendance.</p>
      <p className="note">By signing in you agree to the <a href="/terms">Terms</a> and the <a href="/privacy">Privacy Policy</a>.</p>
    </div>
  );
}

function Home({ user }: any) {
  const [phase, setPhase] = useState("idle"); // idle | locating | scanning | sending
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [totalDays, setTotalDays] = useState(0);
  const [nights, setNights] = useState<any[]>([]);
  const [info, setInfo] = useState<any>(null);
  const [gpsNote, setGpsNote] = useState("");
  const [role, setRole] = useState("student");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showWarden, setShowWarden] = useState(false);
  const [, tick] = useState(0);
  const attempt = useRef<any>(null);
  const gps = useRef<any>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    supabase.from("profiles").select("role").eq("id", user.id).single().then(({ data }) => setRole(data?.role ?? "student"));
    const t = setInterval(() => tick((x) => x + 1), 30000); // keeps the "opens at" text fresh
    return () => clearInterval(t);
  }, []);

  async function load() {
    const { data } = await supabase
      .from("attendance_records")
      .select("status, created_at, attendance_windows(for_date)")
      .order("created_at", { ascending: false });
    setHistory(data ?? []);
    const today = new Date().toLocaleDateString("en-CA");
    const { count } = await supabase.from("attendance_windows").select("id", { count: "exact", head: true }).lte("for_date", today);
    setTotalDays(count ?? 0);
    const from = new Date(Date.now() - 13 * 864e5).toLocaleDateString("en-CA");
    const { data: w } = await supabase.from("attendance_windows").select("for_date").gte("for_date", from).order("for_date");
    setNights(w ?? []);
    const { data: a } = await supabase
      .from("assignments")
      .select("rooms(floor, room_no, hostels(name, window_start, window_end, tz))")
      .is("valid_to", null)
      .maybeSingle();
    setInfo((a as any)?.rooms ?? null);
  }
  useEffect(() => { load(); }, []);

  async function start() {
    setResult(null);
    setPhase("locating");
    // One-time location reading at submission. No tracking.
    gps.current = await new Promise((resolve) =>
      navigator.geolocation
        ? navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 15000 }
          )
        : resolve(null)
    );
    setGpsNote(
      gps.current
        ? `Location read (accuracy about ${Math.round(gps.current.accuracy)} m).`
        : "Location was not available. Allow location for this site in your browser settings, or your attendance may be sent for review."
    );
    const { data, error } = await supabase.functions.invoke("attendance", { body: { action: "start" } });
    if (error || !data?.ok) {
      setResult(data ?? { message: "Could not start. Please try again." });
      setPhase("idle");
      return;
    }
    attempt.current = data;
    setPhase("scanning");
  }

  async function submit(qr: string) {
    setPhase("sending");
    const { data, error } = await supabase.functions.invoke("attendance", {
      body: { action: "submit", attempt_id: attempt.current.attempt_id, nonce: attempt.current.nonce, qr, gps: gps.current },
    });
    setResult(error ? { message: "Could not submit. Please try again." } : data);
    setPhase("idle");
    load();
  }

  // Live camera scan only. There is no file upload anywhere in this app.
  useEffect(() => {
    if (phase !== "scanning" || !video.current) return;
    let handled = false;
    const scanner = new QrScanner(
      video.current,
      (r) => {
        if (handled) return;
        handled = true;
        scanner.stop();
        submit(r.data);
      },
      { returnDetailedScanResult: true, preferredCamera: "environment", highlightScanRegion: false }
    );
    scanner.start().catch(() => {
      setResult({ message: "Camera permission is needed to scan the QR code." });
      setPhase("idle");
    });
    return () => scanner.destroy();
  }, [phase]);

  const staff = role === "warden" || role === "admin";
  if (showWarden)
    return (
      <div>
        <div className="bar"><Brand /><span className="title">Warden</span><span className="bar-actions"><button className="link" onClick={() => setShowWarden(false)}>Back</button></span></div>
        <Warden supabase={supabase} />
      </div>
    );
  if (showAdmin)
    return (
      <div>
        <div className="bar"><Brand /><span className="title">Admin</span><span className="bar-actions"><button className="link" onClick={() => setShowAdmin(false)}>Back</button></span></div>
        <Admin supabase={supabase} me={user.id} />
      </div>
    );

  const present = history.filter((r) => ["present", "manual_present"].includes(r.status)).length;
  const pct = totalDays ? Math.min(100, Math.round((100 * present) / totalDays)) : 0;
  const byDate: any = {};
  history.forEach((r) => {
    const d = r.attendance_windows?.for_date;
    if (d) byDate[d] = r.status;
  });
  const dates = Array.from(new Set(nights.map((n: any) => n.for_date))) as string[];

  const h = info?.hostels;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const clock = (t: string) => {
    const hr = Number(t.slice(0, 2));
    return `${((hr + 11) % 12) + 1}:${t.slice(3, 5)} ${hr < 12 ? "AM" : "PM"}`;
  };
  let when = "Welcome";
  let tonight: string | undefined;
  if (h) {
    const hm = new Date().toLocaleTimeString("en-GB", { timeZone: h.tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
    const n = mins(hm), a = mins(h.window_start), b = mins(h.window_end);
    when = n < a ? `Opens at ${clock(h.window_start)}` : n < b ? `Open until ${clock(h.window_end)}` : "Closed for tonight";
    tonight = byDate[new Date().toLocaleDateString("en-CA", { timeZone: h.tz })];
  }
  const done = tonight === "present" || tonight === "manual_present";
  const cls = (s?: string) => (s === "present" || s === "manual_present" ? "on" : s === "pending_review" ? "review" : "off");

  return (
    <div>
      <div className="bar">
        <Brand />
        <span className="title">HostelPulse</span>
        <span className="bar-actions">
          {staff && <button className="link" onClick={() => setShowWarden(true)}>Warden</button>}
          {role === "admin" && <button className="link" onClick={() => setShowAdmin(true)}>Admin</button>}
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </span>
      </div>

      <section className="card">
        <p className="eyebrow">Tonight</p>
        <h1>{when}</h1>
        {info ? (
          <p className="note">{h?.name} · Floor {info.floor} · Room {info.room_no}</p>
        ) : (
          <p className="note">No room is assigned to your account yet. Ask your warden.</p>
        )}
        {done && <span className="chip ok"><Icon name="check" /> Attendance recorded</span>}
        {tonight === "pending_review" && <span className="chip warn"><Icon name="clock" /> With your warden for review</span>}
        {tonight === "rejected" && <span className="chip bad">Not accepted, please see your warden</span>}

        {phase === "scanning" ? (
          <>
            <div className="scan"><video ref={video} playsInline muted /></div>
            <p className="note">Point the camera at the hostel QR code.</p>
            <button className="link" onClick={() => setPhase("idle")}>Cancel</button>
          </>
        ) : (
          <>
            <button disabled={phase !== "idle" || done} onClick={start}>
              {phase === "idle" ? (done ? "Done for tonight" : "Mark attendance") : "Please wait..."}
            </button>
            <div className="checks">
              <span className="chip"><Icon name="camera" /> QR scan</span>
              <span className="chip"><Icon name="pin" /> Location</span>
              <span className="chip"><Icon name="wifi" /> College Wi-Fi</span>
            </div>
            <p className="note">To confirm your attendance, this app checks your location and network connection. Be on the college Wi-Fi when you start.</p>
          </>
        )}
        {result && <p className={"result " + (result.level ?? "")}>{result.message}</p>}
        {gpsNote && <p className="note">{gpsNote}</p>}
      </section>

      <section className="card">
        <div className="overview">
          <Ring pct={pct} />
          <div>
            <h2>Your attendance</h2>
            <p className="note">{present} of {totalDays} nights</p>
          </div>
        </div>
        {dates.length > 0 && (
          <>
            <div className="nights">
              {dates.map((d) => (
                <div className="night-wrap" key={d}>
                  <div className={"night " + cls(byDate[d])} role="img" aria-label={`${d}: ${byDate[d] ? byDate[d].replace("_", " ") : "not recorded"}`} />
                  {d.slice(8)}
                </div>
              ))}
            </div>
            <div className="legend">
              <span><i className="dot on" />Present</span>
              <span><i className="dot review" />Needs review</span>
              <span><i className="dot off" />Not recorded</span>
            </div>
          </>
        )}
      </section>

      <Exceptions supabase={supabase} />
      <Passkeys supabase={supabase} />
      <p className="foot"><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
    </div>
  );
}
