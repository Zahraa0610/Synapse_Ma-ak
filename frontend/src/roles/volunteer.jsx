// Volunteer pages. Picked up automatically from src/roles/ (see src/roles.js).
import { useState } from "react";
import { api, formatWhen } from "../api";
import { useAuth, useI18n } from "../context";
import { COMPLAINT_FILTERS, ComplaintForm, NoticeCard, PageTitle, STATUS_LABELS, StatusPill, TASK_KIND_LABELS, useData } from "../shared";
import { Button, Empty, ErrorText, Field, Note } from "../ui";

const HELPER_LABELS = {
  general: "General help",
  medical_student: "Medical student",
  nursing_student: "Nursing student",
  transport: "Transportation",
  companion: "Hospital companion",
};

/* ------------------------------------------------------------------ */
/* Volunteer                                                           */
/* ------------------------------------------------------------------ */

function VolunteerHeader() {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <div className="card stack">
      <div>
        <h2>{user.full_name}</h2>
        <p className="small muted">{[t(HELPER_LABELS[user.helper_type] || "Volunteer"), user.offers_driving ? `${t("Can drive")}${user.car_model ? ` · ${user.car_model}` : ""}` : null].filter(Boolean).join(" · ")}</p>
      </div>
      <Note>{t("You can deliver supplies and accompany patients. This is non-medical help.")}</Note>
    </div>
  );
}

function TaskCard({ task, onChanged }) {
  const { t } = useI18n();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function respond(action) {
    setBusy(true);
    setError("");
    try {
      await api(`/tasks/${task.id}/respond`, { method: "POST", body: JSON.stringify({ action }) });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card stack">
      <div className="spread">
        <span className="eyebrow">{t(TASK_KIND_LABELS[task.kind] || task.kind)}</span>
        <StatusPill value={task.status} />
      </div>
      <strong>{task.title}</strong>
      {task.details && <p className="small">{task.details}</p>}
      <p className="small muted">{[task.location || task.shelter_name, formatWhen(task.scheduled_at)].filter(Boolean).join(" · ")}</p>
      <ErrorText>{error}</ErrorText>
      {task.status === "open" && (
        <div className="action-row">
          <Button ghost type="button" disabled={busy} onClick={() => respond("decline")}>Decline</Button>
          <Button type="button" disabled={busy} onClick={() => respond("accept")}>Accept task</Button>
        </div>
      )}
      {task.mine && task.status === "accepted" && (
        <div className="action-row">
          <Button ghost type="button" disabled={busy} onClick={() => respond("decline")}>Give back</Button>
          <Button type="button" disabled={busy} onClick={() => respond("complete")}>Mark as done</Button>
        </div>
      )}
    </div>
  );
}

export function VolunteerTasksPage() {
  const { t } = useI18n();
  const { data, error, reload } = useData("/volunteer/board");
  const tasks = data?.tasks || [];
  const open = tasks.filter((task) => task.status === "open");
  const mine = tasks.filter((task) => task.mine && task.status === "accepted");
  const done = tasks.filter((task) => task.mine && task.status === "completed");
  return (
    <div className="stack">
      <h1>{t("Tasks")}</h1>
      <VolunteerHeader />
      <ErrorText>{error}</ErrorText>
      <section className="stack">
        <h3>{t("New matches for you")}</h3>
        {open.length === 0 && <Empty>{t("No open tasks right now.")}</Empty>}
        {open.map((task) => <TaskCard key={task.id} task={task} onChanged={reload} />)}
      </section>
      <section className="stack">
        <h3>{t("My upcoming tasks")}</h3>
        {mine.length === 0 && <Empty>{t("You have not accepted a task yet.")}</Empty>}
        {mine.map((task) => <TaskCard key={task.id} task={task} onChanged={reload} />)}
      </section>
      {done.length > 0 && (
        <section className="stack">
          <h3>{t("Completed")}</h3>
          {done.map((task) => <TaskCard key={task.id} task={task} onChanged={reload} />)}
        </section>
      )}
    </div>
  );
}

export function VolunteerNoticesPage() {
  const { t } = useI18n();
  const { data, error } = useData("/volunteer/board");
  const items = data?.announcements || [];
  return (
    <div className="stack">
      <PageTitle sub="Doctor visits, free check-ups, screening days and vaccination campaigns.">Notices</PageTitle>
      <ErrorText>{error}</ErrorText>
      {data && items.length === 0 && <Empty>{t("No visits announced.")}</Empty>}
      {items.map((item) => <NoticeCard key={item.id} item={item} />)}
    </div>
  );
}

// Separate complaints dashboard: volunteers record complaints they hear about and follow them.
export function VolunteerComplaintsPage() {
  const { t } = useI18n();
  const { data, error, reload } = useData("/requests/mine");
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const complaints = data?.complaints || [];
  const count = (status) => complaints.filter((item) => item.status === status).length;
  const shown = complaints.filter((item) => filter === "all" || item.status === filter);
  return (
    <div className="stack">
      <div className="spread">
        <h1>{t("Complaints")}</h1>
        <Button type="button" soft onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Add a complaint"}</Button>
      </div>
      <ErrorText>{error}</ErrorText>

      {adding && (
        <section className="card stack">
          <h3>{t("Add a complaint")}</h3>
          <p className="small muted">{t("Record a complaint a resident told you about, by phone, message, photo, note, or in person.")}</p>
          <ComplaintForm forOthers onDone={reload} />
        </section>
      )}

      <div className="stat-grid">
        {["received", "under_review", "being_addressed", "resolved"].map((status) => (
          <div className="stat" key={status}>
            <strong>{count(status)}</strong>
            <span className="small muted">{t(STATUS_LABELS[status])}</span>
          </div>
        ))}
      </div>

      <div className="chip-row" role="group" aria-label={t("Status")}>
        {COMPLAINT_FILTERS.map((value) => (
          <button key={value} type="button" className={`chip ${filter === value ? "active" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {t(value === "all" ? "All" : STATUS_LABELS[value])}
          </button>
        ))}
      </div>

      <section className="card">
        {data && shown.length === 0 && <Empty>{t("No complaints here yet.")}</Empty>}
        {shown.map((item) => (
          <div className="row" key={item.id}>
            <div>
              <strong>{t(item.category)}</strong>
              <div className="small muted">{[item.shelter_name, formatWhen(item.created_at)].filter(Boolean).join(" · ")}</div>
              <div className="small">{item.description}</div>
            </div>
            <StatusPill value={item.status} />
          </div>
        ))}
      </section>
    </div>
  );
}

// Signs a volunteer may notice, grouped so the checklist is easy to scan.
const SUPPORT_SIGN_GROUPS = [
  ["Bullying", ["Bullying of a child with a disability", "Other bullying or harassment"]],
  ["Mood", ["Repeated anxiety or nightmares", "Withdrawn or constantly sad", "Aggressive or very angry"]],
  ["Daily life", ["Not eating or not sleeping", "Stopped talking or playing", "Talks about hurting themselves"]],
];

// Report a case that needs mental health support.
export function VolunteerSupportPage() {
  const { t } = useI18n();
  const { data, reload } = useData("/requests/mine");
  const shelters = useData("/shelters");
  const blank = { person_description: "", shelter_id: "", reason: "" };
  const [form, setForm] = useState(blank);
  const [signs, setSigns] = useState([]);
  const [linked, setLinked] = useState(null);
  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const toggle = (sign) => setSigns((cur) => (cur.includes(sign) ? cur.filter((x) => x !== sign) : [...cur, sign]));
  const urgent = signs.includes("Talks about hurting themselves");

  async function search(event) {
    event.preventDefault();
    setError("");
    try {
      const result = await api(`/roster?q=${encodeURIComponent(query.trim())}`);
      setPeople(result.people);
      if (result.people.length === 0) setError(t("Nobody found with that name."));
    } catch (err) {
      setError(err.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSent(false);
    setBusy(true);
    try {
      await api("/support-flags", {
        method: "POST",
        body: JSON.stringify({
          person_description: form.person_description,
          profile_id: linked?.id || null,
          shelter_id: form.shelter_id || linked?.shelter_id || null,
          signs: signs.map((sign) => t(sign)),
          reason: form.reason,
        }),
      });
      setForm(blank);
      setSigns([]);
      setLinked(null);
      setLinking(false);
      setPeople([]);
      setQuery("");
      setSent(true);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <PageTitle sub="Tell us about someone who may need mental health support. A professional follows up in private.">Report a support case</PageTitle>

      <form className="card stack" onSubmit={submit}>
        <section className="form-section">
          <h3>1. {t("Who needs support?")}</h3>
          <Field label="Describe the person">
            <input value={form.person_description} onChange={set("person_description")} placeholder={t("e.g. Boy, about 9, room 3")} maxLength={200} required={!linked} />
          </Field>
          <Field label="Shelter">
            <select value={form.shelter_id} onChange={set("shelter_id")}>
              <option value="">{t("Not in a shelter / not sure")}</option>
              {(shelters.data?.shelters || []).map((shelter) => <option key={shelter.id} value={shelter.id}>{shelter.name}</option>)}
            </select>
          </Field>
          {linked ? (
            <div className="linked-person">
              <span>{t("Linked to")}: <strong>{linked.full_name}</strong>{linked.shelter_name ? ` · ${linked.shelter_name}` : ""}</span>
              <button className="text-btn" type="button" onClick={() => setLinked(null)}>{t("Remove link")}</button>
            </div>
          ) : !linking ? (
            <button className="text-btn" type="button" onClick={() => setLinking(true)}>+ {t("Link a registered person (optional)")}</button>
          ) : (
            <div className="stack">
              <div className="inline">
                <input aria-label={t("Search by name")} placeholder={t("Search by name")} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") search(e); }} />
                <Button type="button" soft onClick={search}>Search</Button>
              </div>
              {people.map((p) => (
                <button key={p.id} type="button" className="row row-button" onClick={() => { setLinked(p); setPeople([]); setLinking(false); }}>
                  <span><strong>{p.full_name}</strong><span className="small muted"> · {p.shelter_name || t("No shelter")}</span></span>
                  <span className="text-btn">{t("Choose")}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="form-section">
          <h3>2. {t("What did you notice?")}</h3>
          {SUPPORT_SIGN_GROUPS.map(([group, items]) => (
            <fieldset className="check-group" key={group}>
              <legend>{t(group)}</legend>
              {items.map((sign) => (
                <label className="check" key={sign}>
                  <input type="checkbox" checked={signs.includes(sign)} onChange={() => toggle(sign)} /> {t(sign)}
                </label>
              ))}
            </fieldset>
          ))}
          {urgent && (
            <div className="banner rose small">
              <strong>{t("If the person is in danger right now, call 140 (Lebanese Red Cross).")}</strong>
              <div>{t("Embrace Lifeline (free, confidential): 1564.")}</div>
            </div>
          )}
        </section>

        <section className="form-section">
          <h3>3. {t("Describe the case briefly")}</h3>
          <Field label="What happened?">
            <textarea rows={3} maxLength={500} value={form.reason} onChange={set("reason")} placeholder={t("A few sentences: what you saw, when, and where.")} required />
          </Field>
          <span className="small muted">{form.reason.length}/500</span>
        </section>

        <ErrorText>{error}</ErrorText>
        {sent && <div className="banner green small">{t("Sent. A professional will follow up.")}</div>}
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send support request"}</Button>
        <p className="small muted">{t("A flag asks for a human follow-up. It is not a diagnosis.")}</p>
      </form>

      <section className="card stack">
        <h3>{t("My previous requests")}</h3>
        {data && data.flags.length === 0 && <Empty>{t("No requests yet.")}</Empty>}
        {(data?.flags || []).map((item) => (
          <div className="row" key={item.id}>
            <div>
              <strong>{item.who}</strong>
              <div className="small muted">{[item.shelter_name, formatWhen(item.created_at)].filter(Boolean).join(" · ")}</div>
              {item.signs?.length > 0 && <div className="chip-row tight">{item.signs.map((sign) => <span key={sign} className="tag">{sign}</span>)}</div>}
              <div className="small">{item.reason}</div>
            </div>
            <StatusPill value={item.status} />
          </div>
        ))}
      </section>
    </div>
  );
}

const VOLUNTEER = ["volunteer"];

// [path, page, roles allowed] — added to the app by src/roles.js
export const ROUTES = [
  ["/volunteer", VolunteerTasksPage, VOLUNTEER],
  ["/volunteer/notices", VolunteerNoticesPage, VOLUNTEER],
  ["/volunteer/complaints", VolunteerComplaintsPage, VOLUNTEER],
  ["/volunteer/support", VolunteerSupportPage, VOLUNTEER],
];
