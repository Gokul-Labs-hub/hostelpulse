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

  return (
    <div>
      <div className="card">
        <h2>Daily attendance</h2>
        <select value={hostel} onChange={(e) => setHostel(e.target.value)}>
          {hostels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <p className="note">Present {present} of {rows.length} · Needs review {review} · Absent {rows.length - present - review}</p>
        <button onClick={exportCsv}>Export CSV</button>
      </div>

      <div className="card">
        <h2>By floor</h2>
        <ul>
          {Object.keys(floors).map((f) => (
            <li key={f}><span>Floor {f}</span><span>{floors[f].present} / {floors[f].total}</span></li>
          ))}
        </ul>
      </div>

      <ExceptionQueue supabase={supabase} onDecided={load} />

      <div className="card">
        <input placeholder="Search name, student number or room" value={q} onChange={(e) => setQ(e.target.value)} />
        {shown.map((r) => (
          <div className="who" key={r.student_id}>
            <span>{r.full_name || "(no name)"} · {r.student_no ?? "-"} · Room {r.room_no}</span>
            <span className="note">
              {label[key(r)] ?? "absent"}{r.level ? ` · risk: ${r.level}` : ""}
            </span>
            {key(r) === "pending_review" && (
              <>
                <span className="note">{(r.reasons ?? []).join(" · ")}</span>
                <div className="actions">
                  <button className="small" onClick={() => decide(r, "manual_present")}>Approve</button>
                  <button className="small" onClick={() => decide(r, "rejected")}>Reject</button>
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
