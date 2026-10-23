import { useEffect, useState } from "react";

export default function Admin({ supabase, me }: any) {
  const [tab, setTab] = useState("roster");
  return (
    <div>
      <div className="card tabs">
        {["roster", "hostel", "people"].map((t) => (
          <button key={t} className={tab === t ? "" : "link"} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "roster" && <Roster supabase={supabase} />}
      {tab === "hostel" && <HostelSettings supabase={supabase} />}
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
    const [head, ...lines] = text.trim().split("\n").map((l) => l.split(",").map((c) => c.trim()));
    const rows = lines.filter((l) => l.length > 1).map((l) => Object.fromEntries(head.map((k, i) => [k, l[i]])));
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
    const { data } = await supabase.from("profiles").select("id, full_name, student_no, role").order("full_name");
    setRows(data ?? []);
  };
  useEffect(() => { load(); }, []);
  async function setRole(id: string, role: string) {
    await supabase.from("profiles").update({ role }).eq("id", id);
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
        </label>
      ))}
    </div>
  );
}
