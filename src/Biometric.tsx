import { useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { Brand } from "./ui";

// Signs in with a saved fingerprint or Face ID. Returns an error message, or null when it worked.
export async function passkeyLogin(supabase: any): Promise<string | null> {
  try {
    const { data: o } = await supabase.functions.invoke("passkey", { body: { action: "auth_options" } });
    if (!o?.options) return "Could not start. Please try again.";
    const response = await startAuthentication({ optionsJSON: o.options });
    const { data: v } = await supabase.functions.invoke("passkey", {
      body: { action: "auth_verify", challenge_id: o.challenge_id, response },
    });
    if (!v?.token_hash) return v?.message ?? "Could not verify. Please try again.";
    const { error } = await supabase.auth.verifyOtp({ token_hash: v.token_hash, type: "magiclink" });
    if (error) return "Could not sign you in. Please try again.";
    const { data: m } = await supabase.functions.invoke("passkey", { body: { action: "mark_session", token_hash: v.token_hash } });
    if (!m?.ok) return m?.message ?? "Could not finish signing in. Please try again.";
    sessionStorage.setItem("hp-unlocked", "1"); // unlocked for this opening of the app
    window.dispatchEvent(new Event("hp-verified"));
    return null;
  } catch {
    return "That was cancelled, or fingerprint or Face ID is not saved on this device.";
  }
}

// Nobody reaches the portal until this session has been opened with fingerprint or Face ID.
export function Gate({ supabase, children }: any) {
  const [st, setSt] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" && !!window.PublicKeyCredential;

  async function refresh() {
    const { data, error } = await supabase.functions.invoke("passkey", { body: { action: "status" } });
    setSt(error || !data?.ok ? { failed: true } : data);
  }
  useEffect(() => {
    refresh();
    window.addEventListener("hp-verified", refresh);
    return () => window.removeEventListener("hp-verified", refresh);
  }, []);

  async function enroll() {
    setBusy(true);
    setMsg("");
    try {
      const { data: o } = await supabase.functions.invoke("passkey", { body: { action: "reg_options" } });
      if (!o?.options) {
        setMsg(o?.message ?? "Could not start. Please try again.");
      } else {
        const response = await startRegistration({ optionsJSON: o.options });
        const { data: v } = await supabase.functions.invoke("passkey", {
          body: { action: "reg_verify", challenge_id: o.challenge_id, response, label: "Added " + new Date().toLocaleDateString("en-CA") },
        });
        if (v?.ok) {
          sessionStorage.setItem("hp-unlocked", "1");
          await refresh();
        }
        else setMsg(v?.message ?? "Could not add this device.");
      }
    } catch {
      setMsg("That was cancelled, or this device does not support it. Please try again.");
    }
    setBusy(false);
  }

  async function unlock() {
    setBusy(true);
    setMsg("");
    const err = await passkeyLogin(supabase);
    if (err) setMsg(err);
    setBusy(false);
  }

  const signOut = <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>;

  if (!st) return <p className="note">Checking...</p>;
  if (st.failed)
    return (
      <div className="card">
        <Brand size={40} />
        <h2>Could not check your sign-in</h2>
        <p className="note">Check your connection and try again.</p>
        <button onClick={refresh}>Try again</button>
        {signOut}
      </div>
    );
  // Even with a saved sign-in, fingerprint or Face ID is asked once every time the app is opened.
  if (st.exempt || (st.verified && sessionStorage.getItem("hp-unlocked") === "1")) return <>{children}</>;

  if (!st.has_passkeys)
    return (
      <div className="card">
        <Brand size={40} />
        <h2>Set up fingerprint or Face ID</h2>
        <p className="note">This is a one-time step on this phone. From now on you will use it to open HostelPulse. Your fingerprint or face never leaves your phone. If your phone has no fingerprint or Face ID, your screen lock works too.</p>
        {supported ? (
          <button disabled={busy} onClick={enroll}>Set up now</button>
        ) : (
          <p className="note">This device cannot use fingerprint, Face ID or a screen lock for sign-in. Ask your warden about an exception.</p>
        )}
        {msg && <p className="note">{msg}</p>}
        {signOut}
      </div>
    );

  return (
    <div className="card">
      <Brand size={40} />
        <h2>Verify it is you</h2>
      <p className="note">Use the same fingerprint or Face ID you registered when you first signed in.</p>
      <button disabled={busy} onClick={unlock}>Verify</button>
      {msg && <p className="note">{msg}</p>}
      <p className="note">New phone, or nothing saved on this one? Ask your warden to reset your fingerprint, then sign in again.</p>
      {signOut}
    </div>
  );
}
