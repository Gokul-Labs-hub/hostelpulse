import { useEffect, useState } from "react";

export default function Exceptions({ supabase }: any) {
  const [days, setDays] = useState<any[]>([]);
  const [mine, setMine] = useState<any[]>([]);
  const [win, setWin] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const from = new Date(Date.now() - 7 * 864e5).toLocaleDateString("en-CA");
    const { data: w } = await supabase.from("attendance_windows").select("id, for_date").gte("for_date", from).order("for_date", { ascending: false });
    setDays(w ?? []);
    if (w?.[0] && !win) setWin(w[0].id);
    const { data: m } = await supabase.from("exception_requests").select("status, reason, attendance_windows(for_date)").order("created_at", { ascending: false }).limit(10);
    setMine(m ?? []);
  }
  useEffect(() => { load(); }, []);

  async function send() {
    if (reason.trim().length < 5) return setMsg("Please write a short reason (at least 5 characters).");
    const { error } = await supabase.rpc("request_exception", { p_window: win, p_reason: reason });
    if (error) return setMsg(error.message);
    setReason("");
    setMsg("Request sent to your warden.");
    load();
  }

  return (
    <div className="card">
      <h2>Missed a night?</h2>
      {days.length === 0 ? (
        <p className="note">No recent attendance days yet.</p>
      ) : (
        <>
          <select value={win} onChange={(e) => setWin(e.target.value)}>
            {days.map((d) => <option key={d.id} value={d.id}>{d.for_date}</option>)}
          </select>
          <textarea rows={3} maxLength={500} placeholder="Why did you miss it? Your warden will read this." value={reason} onChange={(e) => setReason(e.target.value)} />
          <button onClick={send}>Send request</button>
        </>
      )}
      {msg && <p className="note">{msg}</p>}
      <ul>
        {mine.map((m, i) => (
          <li key={i}><span>{m.attendance_windows?.for_date}</span><span>{m.status}</span></li>
        ))}
      </ul>
    </div>
  );
}
