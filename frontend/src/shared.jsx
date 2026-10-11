// Components and helpers used by more than one role's pages.
import { useEffect, useState } from "react";
import { api, fileUrl, formatWhen } from "./api";
import { useAuth, useI18n } from "./context";
import { Button, Empty, ErrorText, Field, Pill, Select } from "./ui";

export const ENTRY_TYPES = ["condition", "allergy", "medication", "operation", "lab", "report", "vaccine", "note"];

export function useData(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(path));
  async function reload() {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api(path));
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    reload();
  }, [path]);
  return { data, error, loading, reload, setError };
}

export const NOTICE_KINDS = [
  { value: "doctor_visit", label: "Volunteer doctor visit" },
  { value: "free_healthcare_day", label: "Free healthcare day" },
  { value: "screening", label: "Free screening day" },
  { value: "vaccination", label: "Vaccination campaign" },
  { value: "other", label: "Other health event" },
];

export function noticeWhen(item) {
  if (!item.starts_at) return "";
  const start = formatWhen(item.starts_at);
  if (!item.ends_at) return start;
  const sameDay = item.starts_at.slice(0, 10) === item.ends_at.slice(0, 10);
  return `${start} – ${sameDay ? new Date(item.ends_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : formatWhen(item.ends_at)}`;
}

// One event (doctor visit, screening day...) as everyone sees it.
export function NoticeCard({ item, onRemove }) {
  const { t } = useI18n();
  const where = item.shelter_name || (item.region ? `${t("Region")}: ${item.region}` : t("All of Lebanon"));
  return (
    <div className="card stack notice">
      <div className="spread">
        <span className="eyebrow">{t(NOTICE_KINDS.find((k) => k.value === item.kind)?.label || item.kind)}</span>
        <span className="small muted">{noticeWhen(item)}</span>
      </div>
      <strong>{item.title}</strong>
      <p className="small muted">{[item.location, where].filter(Boolean).join(" · ")}</p>
      {item.details && <p className="small">{item.details}</p>}
      <div className="spread">
        {item.posted_by && <span className="small muted">{t("Posted by")} {item.posted_by}{item.posted_by_role ? ` · ${t(item.posted_by_role)}` : ""}</span>}
        {onRemove && <button className="text-btn" type="button" onClick={() => onRemove(item)}>{t("Remove")}</button>}
      </div>
    </div>
  );
}

export function EntryRow({ entry, onChanged, readOnly }) {
  const { t } = useI18n();
  const [opening, setOpening] = useState(false);
  async function openFile(id) {
    setOpening(true);
    const url = await fileUrl(`/attachments/${id}`);
    window.open(url, "_blank");
    setOpening(false);
  }
  return (
    <div className="row">
      <div>
        <strong>{entry.title}</strong>
        <div className="small muted">{entry.entry_type} · {entry.occurred_on || "No date"} {entry.facility_name ? `· ${entry.facility_name}` : ""}</div>
        {entry.details && <div className="small">{entry.details}</div>}
        {entry.result_text && <div className="small">Result: {entry.result_text}</div>}
        <div className="small">{entry.author_type === "clinician" ? t("Clinician-entered") : t("Patient-entered")}{entry.author_name ? ` · ${entry.author_name}` : ""}</div>
        {entry.attachments?.map((file) => (
          <button key={file.id} className="text-btn" type="button" disabled={opening} onClick={() => openFile(file.id)}>{file.filename}</button>
        ))}
      </div>
      <div className="stack">
        {entry.vaccine_status && <Pill value={entry.vaccine_status}>{entry.vaccine_status}</Pill>}
        {!readOnly && <button className="text-btn" type="button" onClick={async () => { await api(`/entries/${entry.id}`, { method: "DELETE" }); onChanged(); }}>Remove</button>}
      </div>
    </div>
  );
}

export function EntryForm({ profileId, onDone }) {
  const [form, setForm] = useState({ entry_type: "condition", title: "", details: "", occurred_on: "", facility_name: "", doctor_name: "", result_text: "", vaccine_status: "administered" });
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const created = await api(`/profiles/${profileId}/entries`, { method: "POST", body: JSON.stringify(form) });
      if (file) {
        const body = new FormData();
        body.append("file", file);
        await api(`/entries/${created.entry.id}/attachments`, { method: "POST", body });
      }
      setForm({ ...form, title: "", details: "", result_text: "" });
      setFile(null);
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h3>Add a record</h3>
      <Field label="Title"><input value={form.title} onChange={set("title")} required /></Field>
      <Field label="Details"><textarea value={form.details} onChange={set("details")} /></Field>
      <div className="grid-2">
        <Field label="Date"><input type="date" value={form.occurred_on} onChange={set("occurred_on")} /></Field>
        <Field label="Type">
          <Select value={form.entry_type} onChange={set("entry_type")} options={ENTRY_TYPES.map((value) => ({ value, label: value }))} />
        </Field>
      </div>
      {form.entry_type === "vaccine" && (
        <Field label="Status">
          <Select value={form.vaccine_status} onChange={set("vaccine_status")} options={["administered", "missing", "overdue"].map((value) => ({ value, label: value }))} />
        </Field>
      )}
      <Field label="Facility"><input value={form.facility_name} onChange={set("facility_name")} /></Field>
      <Field label="Result"><input value={form.result_text} onChange={set("result_text")} /></Field>
      <Field label="Attach a file"><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.dcm,.dicom" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      <p className="small muted">PDFs, images, and DICOM files are stored with the record. Images can be opened. DICOM files can be downloaded.</p>
      <ErrorText>{error}</ErrorText>
      <Button type="submit">Save</Button>
    </form>
  );
}

export const LIVING_SITUATIONS = [
  ["tent", "Tent or camp"], ["renting", "Renting"], ["host_family", "With a host family"],
  ["unfinished_building", "Unfinished building"], ["car", "In a car"], ["other", "Other"],
];

export const COMPLAINT_TOPICS = [
  "Medication shortage",
  "Food",
  "Hygiene",
  "Safety",
  "Delayed aid",
  "Other",
];

// One complaint form used by residents, volunteers and coordinators.
// `forOthers` = the person is recording a complaint someone else made (shows "How it reached you").
export function ComplaintForm({ onDone, shelters, forOthers = false }) {
  const { t } = useI18n();
  const blank = { topic: COMPLAINT_TOPICS[0], other: "", description: "", source: forOthers ? "in_person" : "direct", shelter_id: "" };
  const [form, setForm] = useState(blank);
  const [photo, setPhoto] = useState(null);
  const [shelterOptions, setShelterOptions] = useState(shelters || []);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  useEffect(() => {
    if (!shelters) api("/shelters").then((data) => setShelterOptions(data.shelters)).catch(() => {});
  }, [shelters]);
  async function submit(e) {
    e.preventDefault();
    setError("");
    setSent(false);
    const category = form.topic === "Other" ? form.other.trim() : form.topic;
    if (!category) return setError(t("Write what the complaint is about"));
    setBusy(true);
    try {
      const body = new FormData();
      body.append("category", category);
      body.append("description", form.description);
      body.append("source", form.source);
      if (form.shelter_id) body.append("shelter_id", form.shelter_id);
      if (photo) body.append("photo", photo);
      await api("/complaints", { method: "POST", body });
      setForm(blank);
      setPhoto(null);
      e.target.reset();
      setSent(true);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="field">
        <span>{t("What is the complaint about?")}</span>
        <div className="chip-row" role="group">
          {COMPLAINT_TOPICS.map((topic) => (
            <button key={topic} type="button" className={`chip ${form.topic === topic ? "active" : ""}`} aria-pressed={form.topic === topic} onClick={() => setForm({ ...form, topic })}>{t(topic)}</button>
          ))}
        </div>
      </div>
      {form.topic === "Other" && <Field label="Write the topic"><input value={form.other} onChange={set("other")} required /></Field>}
      {forOthers && (
        <Field label="How it reached you">
          <Select value={form.source} onChange={set("source")} options={[
            { value: "in_person", label: "In person" }, { value: "phone", label: "Phone call" }, { value: "message", label: "Message" },
            { value: "email", label: "Email" }, { value: "photo", label: "Photo" }, { value: "note", label: "Written note" },
          ]} />
        </Field>
      )}
      <Field label="Shelter">
        <select value={form.shelter_id} onChange={set("shelter_id")}>
          <option value="">{t("My shelter")}</option>
          {shelterOptions.map((shelter) => <option key={shelter.id} value={shelter.id}>{shelter.name}</option>)}
        </select>
      </Field>
      <Field label="What happened"><textarea rows={4} placeholder={t("Write what happened, when, and where…")} value={form.description} onChange={set("description")} required /></Field>
      <Field label="Attach a photo (optional)"><input type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" onChange={(e) => setPhoto(e.target.files?.[0] || null)} /></Field>
      <ErrorText>{error}</ErrorText>
      {sent && <div className="banner green small">{t("Complaint sent. You can follow its status below.")}</div>}
      <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send complaint"}</Button>
    </form>
  );
}

export const ROLE_NAMES = {
  caregiver: "User / caregiver", volunteer: "Volunteer", doctor: "Doctor", nurse: "Nurse", psychologist: "Psychologist",
  shelter_coordinator: "Shelter coordinator", donor: "Donor", ministry: "Ministry of Public Health", ngo: "NGO",
};

export const VERIFICATION_NAMES = { documents_received: "Documents received", checking: "Checking", approved: "Approved" };

export function ProfilePage() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  return (
    <div className="stack">
      <h1>{user.full_name}</h1>
      <div className="card stack">
        <div className="spread"><span>{t("Email")}</span><span>{user.email}</span></div>
        <div className="spread"><span>{t("Phone number")}</span><span>{user.phone}</span></div>
        <div className="spread"><span>{t("Role")}</span><span>{t(ROLE_NAMES[user.role] || user.role)}</span></div>
        {user.verification_status !== "not_required" && (
          <div className="spread"><span>{t("Verification")}</span><Pill value={user.verification_status}>{t(VERIFICATION_NAMES[user.verification_status] || user.verification_status)}</Pill></div>
        )}
        {user.role === "volunteer" && user.id_document_number && (
          <div className="spread"><span>{t(user.id_document_type === "passport" ? "Passport" : "Lebanese ID")}</span><span>{user.id_document_number}</span></div>
        )}
        {user.role === "volunteer" && user.offers_driving && (
          <div className="spread"><span>{t("Car")}</span><span>{[user.car_model, user.car_plate, user.car_seats ? `${user.car_seats} ${t("seats")}` : null, user.car_wheelchair ? t("Fits a wheelchair") : null].filter(Boolean).join(" · ")}</span></div>
        )}
      </div>
      <Button ghost onClick={logout}>Sign out</Button>
    </div>
  );
}

// Lets a shelter coordinator or approved doctor/nurse set a patient as critical or not.
export function CriticalityControl({ profile, onChanged }) {
  const { t } = useI18n();
  const [level, setLevel] = useState(profile.criticality.level === "critical" ? "critical" : "non_critical");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function change(next) {
    const previous = level;
    setLevel(next);
    setError("");
    setSaved(false);
    try {
      await api(`/profiles/${profile.id}/criticality-review`, { method: "POST", body: JSON.stringify({ classification: next }) });
      setSaved(true);
      onChanged?.();
    } catch (err) {
      setLevel(previous);
      setError(err.message);
    }
  }
  return (
    <div className="crit-control">
      <div className="segment" role="group" aria-label={t("Patient status")}>
        <button type="button" className={level === "critical" ? "active danger" : ""} aria-pressed={level === "critical"} onClick={() => change("critical")}>{t("Critical")}</button>
        <button type="button" className={level === "non_critical" ? "active" : ""} aria-pressed={level === "non_critical"} onClick={() => change("non_critical")}>{t("Not critical")}</button>
      </div>
      {saved && <span className="small muted">{t("Saved")}</span>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

// Runs an API call, keeps its error, and reloads the page data afterwards.
export function useAction(reload) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(path, method, body) {
    setBusy(true);
    setError("");
    try {
      const options = { method };
      if (body !== undefined) options.body = body instanceof FormData ? body : JSON.stringify(body);
      const result = await api(path, options);
      reload?.();
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, error, busy, setError };
}

// Small controlled form helper: const [form, set, reset] = useForm({...})
export function useForm(initial) {
  const [form, setForm] = useState(initial);
  const set = (key) => (e) => setForm((cur) => ({ ...cur, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  return [form, set, () => setForm(initial)];
}

export function StatusSelect({ value, options, onChange, label }) {
  const { t } = useI18n();
  return (
    <select aria-label={t(label || "Status")} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => <option key={option} value={option}>{t(STATUS_LABELS[option] || option)}</option>)}
    </select>
  );
}

export function Stat({ value, label, tone }) {
  const { t } = useI18n();
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <strong>{value}</strong>
      <span className="small muted">{t(label)}</span>
    </div>
  );
}

export function PageTitle({ children, sub }) {
  const { t } = useI18n();
  return (
    <div>
      <h1>{t(children)}</h1>
      {sub && <p className="muted">{t(sub)}</p>}
    </div>
  );
}

export const money = (amount, currency = "USD") => (amount == null ? "" : `${Number(amount).toLocaleString()} ${currency}`);

export const STATUS_LABELS = {
  received: "Received",
  under_review: "Under review",
  being_addressed: "Being addressed",
  resolved: "Resolved",
  open: "Open",
  accepted: "Accepted",
  completed: "Completed",
  acknowledged: "Acknowledged",
  closed: "Closed",
  pledged: "Pledged",
  allocated: "Allocated",
  distributed: "Distributed",
  proposed: "Proposed",
  in_transit: "In transit",
  requested: "Requested",
  escalated: "Escalated",
  reported: "Reported",
  investigating: "Investigating",
  submitted: "Submitted",
  connected: "Connected",
  delivered: "Delivered",
  available: "Available",
  low: "Low",
  shortage: "Shortage",
  critical: "Critical",
  non_critical: "Not critical",
  cancelled: "Cancelled",
  documents_received: "Documents received",
  checking: "Checking",
  approved: "Approved",
  rejected: "Rejected",
};

export function StatusPill({ value }) {
  const { t } = useI18n();
  return <Pill value={value}>{t(STATUS_LABELS[value] || value)}</Pill>;
}

export const TASK_KIND_LABELS = { delivery: "Supply delivery", companion: "Hospital companion", other: "Other help" };

// Post an event and manage the ones you posted. Used by the Ministry, doctors/nurses and shelter coordinators.
// `scope`: "any" lets the poster choose all of Lebanon, a region or one shelter; "own-shelter" fixes it.
export function NoticesManager({ scope = "any" }) {
  const { t } = useI18n();
  const { data, error, reload } = useData("/announcements");
  const shelters = useData(scope === "any" ? "/shelters" : null);
  const blank = { kind: "doctor_visit", title: "", location: "", starts_at: "", ends_at: "", details: "", target: "all", region: "", shelter_id: "" };
  const [form, set, reset] = useForm(blank);
  const post = useAction(reload);
  const remove = useAction(reload);
  const [sent, setSent] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setSent(false);
    const body = { kind: form.kind, title: form.title, location: form.location, starts_at: form.starts_at, ends_at: form.ends_at || null, details: form.details };
    if (form.target === "region") body.region = form.region;
    if (form.target === "shelter") body.shelter_id = Number(form.shelter_id);
    if (await post.run("/announcements", "POST", body)) { reset(); setSent(true); }
  }
  const mine = data?.mine || [];
  return (
    <>
      <form className="card stack" onSubmit={submit}>
        <h3>{t("Post a health event")}</h3>
        <div className="grid-2">
          <Field label="Type"><Select value={form.kind} onChange={set("kind")} options={NOTICE_KINDS} /></Field>
          <Field label="Title"><input value={form.title} onChange={set("title")} placeholder={t("e.g. Free eye check-ups")} required /></Field>
          <Field label="Starts"><input type="datetime-local" value={form.starts_at} onChange={set("starts_at")} required /></Field>
          <Field label="Ends (optional)"><input type="datetime-local" value={form.ends_at} onChange={set("ends_at")} /></Field>
          <Field label="Place"><input value={form.location} onChange={set("location")} placeholder={t("e.g. Ground-floor hall")} /></Field>
        </div>
        {scope === "any" && (
          <fieldset className="check-group">
            <legend>{t("Who should see it?")}</legend>
            <label className="check"><input type="radio" name="target" checked={form.target === "all"} onChange={() => set("target")({ target: { value: "all" } })} /> {t("All of Lebanon")}</label>
            <label className="check"><input type="radio" name="target" checked={form.target === "region"} onChange={() => set("target")({ target: { value: "region" } })} /> {t("One region")}</label>
            <label className="check"><input type="radio" name="target" checked={form.target === "shelter"} onChange={() => set("target")({ target: { value: "shelter" } })} /> {t("One shelter")}</label>
          </fieldset>
        )}
        {scope === "any" && form.target === "region" && (
          <Field label="Region">
            <select value={form.region} onChange={set("region")} required>
              <option value="">—</option>
              {REGION_LIST.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        )}
        {scope === "any" && form.target === "shelter" && (
          <Field label="Shelter">
            <select value={form.shelter_id} onChange={set("shelter_id")} required>
              <option value="">—</option>
              {(shelters.data?.shelters || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        {scope === "own-shelter" && <p className="small muted">{t("Residents of your shelter will see it.")}</p>}
        <Field label="Details (optional)"><textarea rows={3} value={form.details} onChange={set("details")} placeholder={t("Who it is for, what to bring…")} /></Field>
        <ErrorText>{post.error}</ErrorText>
        {sent && <div className="banner green small">{t("Posted. People see it in their notices now.")}</div>}
        <Button type="submit" disabled={post.busy}>Post event</Button>
      </form>
      <section className="stack">
        <h3>{t("Events you posted")}</h3>
        <ErrorText>{error || remove.error}</ErrorText>
        {data && mine.length === 0 && <Empty>{t("You have not posted any events yet.")}</Empty>}
        {mine.map((item) => <NoticeCard key={item.id} item={item} onRemove={(n) => remove.run(`/announcements/${n.id}`, "DELETE")} />)}
      </section>
    </>
  );
}

export const COMPLAINT_FILTERS = ["all", "received", "under_review", "being_addressed", "resolved"];

// Status-tracked complaint list used by the shelter coordinator and the Ministry.
export function ComplaintBoard({ rows, reload, t, canAdd = true }) {
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const action = useAction(reload);
  const count = (status) => rows.filter((r) => r.status === status).length;
  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  return (
    <>
      <div className="stat-grid">
        {["received", "under_review", "being_addressed", "resolved"].map((status) => <Stat key={status} value={count(status)} label={STATUS_LABELS[status]} />)}
      </div>
      <div className="spread">
        <div className="chip-row" role="group" aria-label={t("Status")}>
          {COMPLAINT_FILTERS.map((value) => (
            <button key={value} type="button" className={`chip ${filter === value ? "active" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(value === "all" ? "All" : STATUS_LABELS[value])}</button>
          ))}
        </div>
        {canAdd && <Button type="button" soft onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Add a complaint"}</Button>}
      </div>
      {adding && <section className="card stack"><h3>{t("Add a complaint")}</h3><ComplaintForm forOthers onDone={reload} /></section>}
      <section className="card">
        <ErrorText>{action.error}</ErrorText>
        {shown.length === 0 && <Empty>{t("No complaints here yet.")}</Empty>}
        {shown.map((item) => (
          <div className="row" key={item.id}>
            <div><strong>{t(item.category)}</strong><div className="small muted">{[item.shelter_name, item.region, item.source, formatWhen(item.created_at)].filter(Boolean).join(" · ")}</div><div className="small">{item.description}</div></div>
            <StatusSelect value={item.status} options={["received", "under_review", "being_addressed", "resolved"]} onChange={(status) => action.run(`/complaints/${item.id}`, "PATCH", { status })} />
          </div>
        ))}
      </section>
    </>
  );
}

export const currentMonth = () => new Date().toISOString().slice(0, 7);

export function HistoryTable({ history }) {
  const { t } = useI18n();
  if (!history || history.length === 0) return <Empty>{t("No reports yet.")}</Empty>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>{t("Month")}</th><th>{t("Shortages")}</th><th>{t("Occupancy")}</th><th>{t("Complaints")}</th><th>{t("Critical")}</th></tr></thead>
        <tbody>{history.map((row) => <tr key={row.month}><td>{row.month}{row.month === currentMonth() ? <span className="small muted"> · {t("this month, live")}</span> : null}</td><td>{row.shortages}</td><td>{row.occupancy}</td><td>{row.complaints}</td><td>{row.critical}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export const REGION_LIST = ["Beirut", "Mount Lebanon", "North", "Akkar", "Bekaa", "Baalbek-Hermel", "South", "Nabatieh"];
