import { useEffect, useState } from "react";

const label: any = { present: "present", manual_present: "present (warden)", pending_review: "needs review", rejected: "rejected" };
const order: any = { pending_review: 0, rejected: 1, absent: 1, present: 2, manual_present: 2 };
// Stops spreadsheet formulas such as =HYPERLINK(...) hidden in names from running when the CSV is opened.
const safe = (c: any) => (/^[=+\-@]/.test(String(c ?? "")) ? "'" + c : String(c ?? ""));

export default function Warden({ supabase }: any) {
  const [hostels, setHostels] = useState<any[]>([]);
  const [hostel, setHostel] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.from("hostels").select("id, name").order("name").then(({ data }: any) => {
      setHostels(data ?? []);
      if (data?.[0]) setHostel(data[0].id);
    });
  }, []);

  async function load() {
    if (!hostel) return;
    const { data, error } = await supabase.rpc("day_roll", { p_hostel: hostel, p_date: date });
    if (error) setMsg(error.message);
    else setRows(data ?? []);
  }
  useEffect(() => { load(); }, [hostel, date]);

  async function decide(r: any, status: string) {
    const { error } = await supabase.rpc("review_attendance", {
      p_student: r.student_id, p_hostel: hostel, p_date: date, p_status: status, p_note: "",
    });
    setMsg(error ? error.message : "Saved.");
    load();
  }

  const key = (r: any) => r.status ?? "absent";
  const present = rows.filter((r) => key(r) === "present" || key(r) === "manual_present").length;
  const review = rows.filter((r) => key(r) === "pending_review").length;
  const floors: any = {};
  rows.forEach((r) => {
    const f = (floors[r.floor] ??= { total: 0, present: 0 });
    f.total++;
    if (key(r) === "present" || key(r) === "manual_present") f.present++;
  });
  const shown = rows
    .filter((r) => `${r.full_name} ${r.student_no ?? ""} ${r.room_no}`.toLowerCase().includes(q.toLowerCase()))
    .filter((r) =>
      filter === "all" ||
      (filter === "review" && key(r) === "pending_review") ||
      (filter === "absent" && (key(r) === "absent" || key(r) === "rejected")) ||
      (filter === "present" && (key(r) === "present" || key(r) === "manual_present"))
    )
    .sort((a, b) => order[key(a)] - order[key(b)]);

  function exportCsv() {
    const lines = [["student_no", "name", "floor", "room", "status", "risk"]].concat(
      rows.map((r) => [r.student_no, r.full_name, r.floor, r.room_no, key(r), r.level])
    );
    const csv = lines.map((l) => l.map((c) => `"${safe(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `attendance-${date}.csv`;
    a.click();
  }

  const absent = rows.length - present - review;
  const chipFor = (r: any) => {
    const k = key(r);
    if (k === "present") return <span className="chip ok">Present</span>;
    if (k === "manual_present") return <span className="chip ok">Present (warden)</span>;
    if (k === "pending_review") return <span className="chip warn">Needs review</span>;
    if (k === "rejected") return <span className="chip bad">Rejected</span>;
    return <span className="chip bad">Absent</span>;
  };

  return (
    <div>
      <div className="card">
        <p className="eyebrow">Daily attendance</p>
        <select value={hostel} onChange={(e) => setHostel(e.target.value)}>
          {hostels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="tiles">
          <div className="tile"><b>{present}</b><span>Present</span></div>
          <div className="tile"><b>{review}</b><span>Needs review</span></div>
          <div className="tile"><b>{absent}</b><span>Absent</span></div>
        </div>
        <p className="note">{rows.length} residents on the list</p>
        <button className="light" onClick={exportCsv}>Export CSV</button>
      </div>

      <div className="card">
        <h2>By floor</h2>
        {Object.keys(floors).map((f) => (
          <div className="floor" key={f}>
            <span>Floor {f}</span>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${floors[f].total ? (100 * floors[f].present) / floors[f].total : 0}%` }} />
            </div>
            <span className="mono">{floors[f].present}/{floors[f].total}</span>
          </div>
        ))}
        {Object.keys(floors).length === 0 && <p className="note">No residents on the list yet.</p>}
      </div>

      <ExceptionQueue supabase={supabase} onDecided={load} />

      <div className="card">
        <input placeholder="Search name, student number or room" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pills">
          {[["all", "All"], ["review", "Needs review"], ["absent", "Absent"], ["present", "Present"]].map(([k, l]) => (
            <button key={k} className={"pill" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        {shown.map((r) => (
          <div className="who" key={r.student_id}>
            <div className="who-top"><strong>{r.full_name || "(no name)"}</strong>{chipFor(r)}</div>
            <span className="note">{r.student_no ?? "-"} · Room {r.room_no}{r.level ? ` · risk ${r.level}` : ""}</span>
            {key(r) === "pending_review" && (
              <>
                <span className="note">{(r.reasons ?? []).join(" · ")}</span>
                <div className="actions">
                  <button className="small" onClick={() => decide(r, "manual_present")}>Approve</button>
                  <button className="small light" onClick={() => decide(r, "rejected")}>Reject</button>
                </div>
              </>
            )}
            {(key(r) === "absent" || key(r) === "rejected") && (
              <div className="actions">
                <button className="small" onClick={() => decide(r, "manual_present")}>Mark present</button>
              </div>
            )}
          </div>
        ))}
        {shown.length === 0 && <p className="note">Nobody matches.</p>}
      </div>
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}

function ExceptionQueue({ supabase, onDecided }: any) {
  const [items, setItems] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const { data } = await supabase
      .from("exception_requests")
      .select("id, reason, created_at, profiles!student_id(full_name, student_no), attendance_windows(for_date)")
      .eq("status", "pending")
      .order("created_at");
    setItems(data ?? []);
  };
  useEffect(() => { load(); }, []);
  async function decide(id: string, approve: boolean) {
    const { error } = await supabase.rpc("decide_exception", { p_id: id, p_approve: approve, p_note: "" });
    setMsg(error ? error.message : "Saved.");
    load();
    onDecided();
  }
  if (items.length === 0 && !msg) return null;
  return (
    <div className="card">
      <h2>Exception requests ({items.length})</h2>
      {items.map((x) => (
        <div className="who" key={x.id}>
          <span>{x.profiles?.full_name} · {x.profiles?.student_no ?? "-"} · {x.attendance_windows?.for_date}</span>
          <span className="note">{x.reason}</span>
          <div className="actions">
            <button className="small" onClick={() => decide(x.id, true)}>Approve</button>
            <button className="small" onClick={() => decide(x.id, false)}>Deny</button>
          </div>
        </div>
      ))}
      {msg && <p className="note">{msg}</p>}
    </div>
  );
}
