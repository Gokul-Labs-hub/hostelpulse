import { useEffect, useState } from "react";
import QRCode from "qrcode";

export default function Admin({ supabase, me }: any) {
  const [tab, setTab] = useState("roster");
  return (
    <div>
      <div className="card tabs">
        {["roster", "hostel", "network", "qr", "risk", "people"].map((t) => (
          <button key={t} className={tab === t ? "" : "link"} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "roster" && <Roster supabase={supabase} />}
      {tab === "hostel" && <HostelSettings supabase={supabase} />}
      {tab === "network" && <NetworkTab supabase={supabase} />}
      {tab === "qr" && <QrTab supabase={supabase} />}
      {tab === "risk" && <RiskTab supabase={supabase} />}
      {tab === "people" && <People supabase={supabase} me={me} />}
    </div>
  );
}

function useHostels(supabase: any) {
  const [hostels, setHostels] = useState<any[]>([]);
  const load = async () => {
    const { data } = await supabase.from("hostels").select("*").order("name");
    setHostels(data ?? []);
  };
  useEffect(() => { load(); }, []);
  return [hostels, load] as const;
}

function Roster({ supabase }: any) {
  const [hostels] = useHostels(supabase);
  const [hostel, setHostel] = useState("");
  const [text, setText] = useState("email,full_name,student_no,floor,room_no\n");
  const [msg, setMsg] = useState("");

  async function run() {
    const all = text.trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim()));
    const hasHeader = all[0]?.[0]?.toLowerCase() === "email";
    const head = hasHeader ? all[0] : ["email", "full_name", "student_no", "floor", "room_no"];
    const rows = (hasHeader ? all.slice(1) : all)
      .filter((l) => l.length > 1)
      .map((l) => Object.fromEntries(head.map((k, i) => [k, l[i]])));
    if (rows.length === 0) {
      setMsg("No student rows found. Each line needs: email,full name,student number,floor,room number");
      return;
    }
    const { data, error } = await supabase.rpc("import_roster", { p_hostel: hostel || hostels[0]?.id, p_rows: rows });
    setMsg(error ? error.message : `${data} students imported. Each gets their room automatically.`);
  }

  return (
    <div className="card">
      <h2>Import student list</h2>
      <p className="note">Columns: email, full_name, student_no, floor, room_no. Plain CSV, no commas inside a field.</p>
      <select value={hostel} onChange={(e) => setHostel(e.target.value)}>
        {hostels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
      </select>
      <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={run}>Import</button>
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}

function HostelSettings({ supabase }: any) {
  const [hostels, reload] = useHostels(supabase);
  const [msg, setMsg] = useState("");

  async function save(h: any, patch: any) {
    const { error } = await supabase.from("hostels").update(patch).eq("id", h.id);
    setMsg(error ? error.message : "Saved.");
    reload();
  }
  function here(h: any) {
    navigator.geolocation.getCurrentPosition(
      (p) => save(h, { lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setMsg("Location not available."),
      { enableHighAccuracy: true }
    );
  }

  return (
    <>
      {hostels.map((h) => (
        <div className="card" key={h.id}>
          <h2>{h.name}</h2>
          <label>Window opens
            <input type="time" defaultValue={h.window_start?.slice(0, 5)} onBlur={(e) => save(h, { window_start: e.target.value })} />
          </label>
          <label>Window closes
            <input type="time" defaultValue={h.window_end?.slice(0, 5)} onBlur={(e) => save(h, { window_end: e.target.value })} />
          </label>
          <label>Boundary radius (metres)
            <input type="number" defaultValue={h.radius_m} onBlur={(e) => save(h, { radius_m: Number(e.target.value) })} />
          </label>
          <p className="note">Centre: {h.lat.toFixed(5)}, {h.lng.toFixed(5)}</p>
          <button onClick={() => here(h)}>Set centre to my current location</button>
        </div>
      ))}
      {msg && <p className="note">{msg}</p>}
    </>
  );
}

function People({ supabase, me }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const load = async () => {
    const { data } = await supabase.from("profiles").select("id, full_name, student_no, role, biometric_exempt").order("full_name");
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);
  async function setRole(id: string, role: string) {
    await supabase.from("profiles").update({ role }).eq("id", id);
    load();
  }
  async function resetBio(id: string) {
    if (!confirm("Remove this person's saved fingerprint or Face ID devices?")) return;
    await supabase.rpc("admin_reset_biometric", { p_user: id });
  }
  async function toggleExempt(r: any) {
    await supabase.from("profiles").update({ biometric_exempt: !r.biometric_exempt }).eq("id", r.id);
    load();
  }
  const shown = rows.filter((r) => `${r.full_name} ${r.student_no ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="card">
      <input placeholder="Search name or student number" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.map((r) => (
        <label key={r.id}>
          {r.full_name || "(no name)"} {r.student_no ?? ""}
          <select value={r.role} disabled={r.id === me} onChange={(e) => setRole(r.id, e.target.value)}>
            <option value="student">student</option>
            <option value="warden">warden</option>
            <option value="admin">admin</option>
          </select>
          <span className="actions">
            <button className="link" onClick={() => resetBio(r.id)}>Reset fingerprint</button>
            <button className="link" onClick={() => toggleExempt(r)}>{r.biometric_exempt ? "Exempt: on" : "Exempt: off"}</button>
          </span>
        </label>
      ))}
    </div>
  );
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function QrTab({ supabase }: any) {
  const [hostels] = useHostels(supabase);
  const [hostel, setHostel] = useState("");
  const [img, setImg] = useState("");
  const [msg, setMsg] = useState("");
  const id = hostel || hostels[0]?.id;
  const name = hostels.find((h) => h.id === id)?.name;

  async function rotate() {
    if (!confirm("Every old printed QR code will stop working. Continue?")) return;
    const secret = "HP-" + [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const { data, error } = await supabase.rpc("rotate_qr", { p_hostel: id, p_hash: await sha256(secret) });
    if (error) return setMsg(error.message);
    setImg(await QRCode.toDataURL(secret, { width: 900, margin: 2 }));
    setMsg(`New QR code (version ${data}) is active. Print it now: it cannot be shown again.`);
  }

  return (
    <div className="card">
      <div className="noprint card">
        <h2>Printable QR code</h2>
        <select value={id ?? ""} onChange={(e) => setHostel(e.target.value)}>
          {hostels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <p className="note">
          Anyone can photograph a printed QR code and share it, so treat it as one layer of checking. Create a new one if you think it has leaked.
        </p>
        <button onClick={rotate}>Create new QR code</button>
        {msg && <p className="note">{msg}</p>}
        {img && <button onClick={() => window.print()}>Print</button>}
      </div>
      {img && (
        <div className="sheet">
          <h1>{name}</h1>
          <img src={img} alt="Attendance QR code" />
          <p>Scan with the HostelPulse app to mark attendance</p>
        </div>
      )}
    </div>
  );
}

function NetworkTab({ supabase }: any) {
  const [info, setInfo] = useState<any>(null);
  const [mode, setMode] = useState("");
  const [label, setLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState<any>(null);
  const call = async (body: any) => {
    const { data, error } = await supabase.functions.invoke("attendance", { body });
    return error ? { failed: true } : data;
  };

  async function load() {
    setInfo(await call({ action: "net_list" }));
    const { data: m } = await supabase.from("app_settings").select("value").eq("key", "verification_mode").single();
    setMode(m?.value ?? "");
    const { data: ev } = await supabase.from("verification_events").select("details").eq("signal", "network").order("created_at", { ascending: false }).limit(500);
    const seen = (ev ?? []).filter((e: any) => e.details?.shadow_match !== null && e.details?.shadow_match !== undefined);
    setStats({ yes: seen.filter((e: any) => e.details.shadow_match).length, no: seen.filter((e: any) => !e.details.shadow_match).length });
  }
  useEffect(() => { load(); }, []);

  async function learn() {
    const d = await call({ action: "net_learn", label });
    setMsg(d?.ok ? `Learned ${d.ip}` : d?.message ?? "Could not learn this network.");
    setLabel("");
    load();
  }
  async function forget(ip: string) { await call({ action: "net_forget", ip }); load(); }
  async function saveMode(v: string) {
    await supabase.from("app_settings").update({ value: v }).eq("key", "verification_mode");
    setMode(v);
  }

  return (
    <>
      <div className="card">
        <h2>College network</h2>
        <p className="note">Connect to the college Wi-Fi (not mobile data). The server currently sees you as: <b>{info?.ip || (info ? "(not readable)" : "...")}</b></p>
        {info?.failed && <p className="note">The server function did not answer correctly. Make sure you pasted and deployed the newest function code.</p>}
        {info?.seen && !info.ip && <p className="note">Headers the server received: {JSON.stringify(info.seen)}</p>}
        <input placeholder="Label, for example Hostel floor 2" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button onClick={learn}>Learn this network</button>
        <p className="note">Repeat from other places (hostel floors, academic block). If the number stays the same everywhere, one is enough.</p>
        {msg && <p className="note">{msg}</p>}
        <ul>
          {(info?.networks ?? []).map((n: any) => (
            <li key={n.ip}><span>{n.label || "(no label)"} · {n.ip}</span><button className="link" onClick={() => forget(n.ip)}>Remove</button></li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2>Network check mode</h2>
        <select value={mode} onChange={(e) => saveMode(e.target.value)}>
          <option value="ip_shadow">ip_shadow (record only, no effect)</option>
          <option value="ip_enforce">ip_enforce (alert students off the college Wi-Fi)</option>
        </select>
        {stats && <p className="note">Shadow results so far: {stats.yes} matched, {stats.no} not matched.</p>}
        <p className="note">Start with ip_shadow. Switch to ip_enforce when nearly everyone matches.</p>
      </div>
    </>
  );
}

function RiskTab({ supabase }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [report, setReport] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const { data } = await supabase.from("risk_weights").select("key, points, label").order("key");
    setRows(data ?? []);
    const { data: r } = await supabase.rpc("signal_report");
    setReport(r ?? []);
  };
  useEffect(() => { load(); }, []);
  async function save(key: string, v: string) {
    const n = Math.max(0, Math.min(100, Math.round(Number(v))));
    const { error } = await supabase.from("risk_weights").update({ points: n }).eq("key", key);
    setMsg(error ? error.message : "Saved.");
    load();
  }

  return (
    <>
      <div className="card">
        <h2>Risk points</h2>
        <p className="note">Each unusual signal adds points. Below the first cutoff is low risk and is accepted. Between the cutoffs goes to a warden. Above the second cutoff needs extra verification. A flag is never proof of cheating.</p>
        {rows.map((r) => (
          <label key={r.key}>{r.label}
            <input type="number" min={0} max={100} defaultValue={r.points} onBlur={(e) => save(r.key, e.target.value)} />
          </label>
        ))}
        {msg && <p className="note">{msg}</p>}
      </div>
      <div className="card">
        <h2>How each signal performed</h2>
        <p className="note">Based on warden decisions. If wardens approve most attempts a signal flagged, it is raising false alarms, so lower its points. If they reject most, it is working.</p>
        {report.length === 0 && <p className="note">No flagged attempts yet.</p>}
        {report.map((s) => (
          <div className="who" key={s.signal}>
            <div className="who-top"><strong>{s.signal}</strong><span className="mono">{s.flagged} flagged</span></div>
            <span className="note">Accepted automatically {s.auto_ok} · Approved by warden {s.approved} · Rejected {s.rejected} · Waiting {s.pending}</span>
          </div>
        ))}
      </div>
    </>
  );
}
