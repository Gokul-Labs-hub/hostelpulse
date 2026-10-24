import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import QrScanner from "qr-scanner";
import Admin from "./Admin";
import Warden from "./Warden";
import Exceptions from "./Exceptions";
import Passkeys from "./Passkeys";
import { startAuthentication } from "@simplewebauthn/browser";

// The anon (publishable) key is safe in the browser: Row Level Security protects the data.
// NEVER put the service_role / secret key in this project.
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export default function App() {
  const [session, setSession] = useState<any>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <main><p className="note">Loading...</p></main>;
  return <main>{session ? <Home user={session.user} /> : <Login />}</main>;
}

function Login() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const clean = email.trim().toLowerCase();

  async function sendCode() {
    if (!/^\S+@\S+\.\S+$/.test(clean)) return setMsg("Enter a valid email address.");
    setBusy(true);
    setMsg("");
    // The same message is shown every time, so this form cannot be used to find out who is registered.
    await supabase.auth.signInWithOtp({ email: clean, options: { shouldCreateUser: true } });
    setStep("code");
    setMsg("If this email is registered, a 6 digit code is on its way. It can take a minute.");
    setBusy(false);
  }

  async function verify() {
    setBusy(true);
    setMsg("");
    const { error } = await supabase.auth.verifyOtp({ email: clean, token: code.trim(), type: "email" });
    if (error) setMsg("That code is not right or has expired. Try again, or go back and request a new one.");
    setBusy(false);
  }

  const google = () => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });

  async function passkeySignIn() {
    setMsg("");
    try {
      const { data: o } = await supabase.functions.invoke("passkey", { body: { action: "auth_options" } });
      if (!o?.options) return setMsg("Could not start. Please try again.");
      const response = await startAuthentication({ optionsJSON: o.options });
      const { data: v } = await supabase.functions.invoke("passkey", { body: { action: "auth_verify", challenge_id: o.challenge_id, response } });
      if (!v?.token_hash) return setMsg(v?.message ?? "Could not sign you in.");
      const { error } = await supabase.auth.verifyOtp({ token_hash: v.token_hash, type: "magiclink" });
      if (error) setMsg("Could not sign you in. Please try again.");
    } catch {
      setMsg("Fingerprint or Face ID was cancelled, or is not set up on this device. Sign in another way, then add it.");
    }
  }

  return (
    <div className="card">
      <h1>HostelPulse</h1>
      <p className="note">Sign in with the email your warden registered for you.</p>
      <button className="light" onClick={google}>Continue with Google</button>
      {typeof window !== "undefined" && window.PublicKeyCredential && (
        <button className="light" onClick={passkeySignIn}>Use fingerprint or Face ID</button>
      )}
      {step === "email" ? (
        <>
          <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button disabled={busy} onClick={sendCode}>Email me a code</button>
        </>
      ) : (
        <>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6 digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
          <button disabled={busy || code.length !== 6} onClick={verify}>Sign in</button>
          <button className="link" onClick={() => { setStep("email"); setCode(""); setMsg(""); }}>Use a different email</button>
        </>
      )}
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}

function Home({ user }: any) {
  const [phase, setPhase] = useState("idle"); // idle | locating | scanning | sending
  const [result, setResult] = useState<any>(null);
  const [gpsNote, setGpsNote] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [totalDays, setTotalDays] = useState(0);
  const attempt = useRef<any>(null);
  const gps = useRef<any>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [role, setRole] = useState("student");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showWarden, setShowWarden] = useState(false);
  useEffect(() => {
    supabase.from("profiles").select("role").eq("id", user.id).single().then(({ data }) => setRole(data?.role ?? "student"));
  }, []);

  async function load() {
    const { data } = await supabase
      .from("attendance_records")
      .select("status, created_at, attendance_windows(for_date)")
      .order("created_at", { ascending: false });
    setHistory(data ?? []);
    const { count } = await supabase
      .from("attendance_windows")
      .select("id", { count: "exact", head: true })
      .lte("for_date", new Date().toISOString().slice(0, 10));
    setTotalDays(count ?? 0);
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
      body: {
        action: "submit",
        attempt_id: attempt.current.attempt_id,
        nonce: attempt.current.nonce,
        qr,
        gps: gps.current,
      },
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
      { returnDetailedScanResult: true, preferredCamera: "environment", highlightScanRegion: true }
    );
    scanner.start().catch(() => {
      setResult({ message: "Camera permission is needed to scan the QR code." });
      setPhase("idle");
    });
    return () => scanner.destroy();
  }, [phase]);

  if (showWarden)
    return (
      <div>
        <header>
          <span>Warden</span>
          <button className="link" onClick={() => setShowWarden(false)}>Back</button>
        </header>
        <Warden supabase={supabase} />
      </div>
    );

  if (showAdmin)
    return (
      <div>
        <header>
          <span>Admin</span>
          <button className="link" onClick={() => setShowAdmin(false)}>Back</button>
        </header>
        <Admin supabase={supabase} me={user.id} />
      </div>
    );

  const present = history.filter((r) => ["present", "manual_present"].includes(r.status)).length;
  const pct = totalDays ? Math.round((100 * present) / totalDays) : 0;

  return (
    <div>
      <header>
        <span>{user.email}</span>
        {(role === "warden" || role === "admin") && <button className="link" onClick={() => setShowWarden(true)}>Warden</button>}
        {role === "admin" && <button className="link" onClick={() => setShowAdmin(true)}>Admin</button>}
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <div className="card">
        <h2>Tonight's attendance</h2>
        {phase === "scanning" ? (
          <>
            <video ref={video} playsInline muted />
            <p className="note">Point the camera at the hostel QR code.</p>
            <button className="link" onClick={() => setPhase("idle")}>Cancel</button>
          </>
        ) : (
          <>
            <button disabled={phase !== "idle"} onClick={start}>
              {phase === "idle" ? "Mark attendance" : "Please wait..."}
            </button>
            <p className="note">To confirm your attendance, this app checks your location and network connection.</p>
          </>
        )}
        {result && <p className={"result " + (result.level ?? "")}>{result.message}</p>}
        {gpsNote && <p className="note">{gpsNote}</p>}
      </div>

      <div className="card">
        <h2>My attendance: {pct}%</h2>
        <p className="note">{present} present out of {totalDays} days</p>
        <ul>
          {history.slice(0, 14).map((r, i) => (
            <li key={i}>
              <span>{r.attendance_windows?.for_date}</span>
              <span>{r.status.replace("_", " ")}</span>
            </li>
          ))}
        </ul>
      </div>

      <Exceptions supabase={supabase} />
      <Passkeys supabase={supabase} />
    </div>
  );
}
