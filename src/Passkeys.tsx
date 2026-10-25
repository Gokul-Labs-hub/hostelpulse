import { useEffect, useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

export default function Passkeys({ supabase }: any) {
  const [list, setList] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const supported = typeof window !== "undefined" && !!window.PublicKeyCredential;

  const load = async () => {
    const { data } = await supabase.from("passkeys").select("id, label, created_at").order("created_at");
    setList(data ?? []);
  };
  useEffect(() => { load(); }, []);

  async function add() {
    setMsg("");
    try {
      const { data: o } = await supabase.functions.invoke("passkey", { body: { action: "reg_options" } });
      if (!o?.options) return setMsg("Could not start. Please try again.");
      const response = await startRegistration({ optionsJSON: o.options });
      const { data: v } = await supabase.functions.invoke("passkey", {
        body: { action: "reg_verify", challenge_id: o.challenge_id, response, label: "Added " + new Date().toLocaleDateString("en-CA") },
      });
      setMsg(v?.ok ? "Added. You can now sign in with your fingerprint or Face ID." : v?.message ?? "Could not add this device.");
      load();
    } catch {
      setMsg("That was cancelled, or this device does not support it.");
    }
  }
  async function remove(id: string) {
    const { data } = await supabase.functions.invoke("passkey", { body: { action: "remove", id } });
    setMsg(data?.ok ? "Removed." : data?.message ?? "Could not remove this device.");
    load();
  }

  if (!supported) return null;
  return (
    <div className="card">
      <h2>Fingerprint or Face ID</h2>
      <p className="note">Sign in faster on this phone without waiting for an email code.</p>
      <button onClick={add}>Add this device</button>
      {msg && <p className="note">{msg}</p>}
      <ul>
        {list.map((p) => (
          <li key={p.id}><span>{p.label || "Device"}</span><button className="link" onClick={() => remove(p.id)}>Remove</button></li>
        ))}
      </ul>
    </div>
  );
}
