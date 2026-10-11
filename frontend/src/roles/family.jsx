// Family pages. Picked up automatically from src/roles/ (see src/roles.js).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatWhen } from "../api";
import { saveOffline, SummaryCard } from "../AuthPages";
import { useAuth, useI18n } from "../context";
import { ComplaintForm, EntryForm, EntryRow, LIVING_SITUATIONS, NoticeCard, useData } from "../shared";
import { Bars, Button, ErrorText, Field, Note, Pill, Select } from "../ui";

const RELATIONS = ["child", "parent", "spouse", "other"];

const DEVICE_KINDS = [
  { value: "oxygen", label: "Oxygen cylinder" },
  { value: "concentrator", label: "Oxygen concentrator" },
  { value: "ventilator", label: "Ventilator" },
  { value: "suction", label: "Suction device" },
  { value: "feeding", label: "Feeding pump" },
  { value: "electricity", label: "Other electric device" },
  { value: "other", label: "Other (write it)" },
];

export function HomePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data, error, reload } = useData("/home");
  const [open, setOpen] = useState(false);
  const first = user.full_name.split(" ")[0];
  return (
    <div className="stack">
      <div>
        <p className="muted">{user.shelter_name || t("Ma'ak")}</p>
        <h1>{t("Welcome")}, {first}</h1>
      </div>
      <ErrorText>{error}</ErrorText>
      {data && (
        <>
          <section>
            <div className="spread"><h3>{t("Family")}</h3><button className="text-btn" type="button" onClick={() => setOpen((v) => !v)}>{t("Add a family member")}</button></div>
            <div className="people-scroll" style={{ marginTop: 8 }}>
              {data.profiles.map((profile) => (
                <Link key={profile.id} to={`/passport?profile=${profile.id}`} className="person-chip">
                  <strong>{profile.full_name.split(" ")[0]}</strong>
                  <div className="small muted">{profile.relationship}</div>
                  <Pill value={profile.criticality.level}>{profile.criticality.level === "critical" ? "Critical" : "Stable"}</Pill>
                </Link>
              ))}
            </div>
            {open && <FamilyForm shelters={[]} onDone={() => { setOpen(false); reload(); }} />}
          </section>
          <div className="grid-2">
            <Link className="card" to="/passport"><strong>{t("Health passport")}</strong><p className="small muted">History, vaccines, files</p></Link>
            <Link className="card" to="/care"><strong>{t("Care needs")}</strong><p className="small muted">{t("Devices, dialysis, pregnancy, food")}</p></Link>
            <Link className="card" to="/requests"><strong>{t("Request transport")}</strong><p className="small muted">Rides and complaints</p></Link>
            <Link className="card" to="/emergency"><strong>{t("Emergency card")}</strong><p className="small muted">{t("Works offline once saved")}</p></Link>
            <Link className="card" to="/requests#donations"><strong>{t("Ask for donations")}</strong><p className="small muted">{t("For families outside shelters")}</p></Link>
          </div>
          <section className="stack">
            <h3>{t("Near you")}</h3>
            {data.announcements.length === 0 && <p className="muted small">{t("No visits announced.")}</p>}
            {data.announcements.map((item) => <NoticeCard key={item.id} item={item} />)}
          </section>
          {data.upcoming.length > 0 && (
            <section className="card">
              <h3>Coming up</h3>
              {data.upcoming.slice(0, 4).map((item, index) => (
                <div className="row" key={index}>
                  <div><strong>{item.who}</strong><div className="small muted">{item.where}</div></div>
                  <span className="small">{formatWhen(item.when)}</span>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function FamilyForm({ onDone }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ full_name: "", relationship: "child", date_of_birth: "", sex: "female", blood_type: "", disability: false });
  const [error, setError] = useState("");
  const set = (key) => (event) => setForm({ ...form, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value });
  async function submit(event) {
    event.preventDefault();
    try {
      await api("/profiles", { method: "POST", body: JSON.stringify(form) });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <form className="card stack" onSubmit={submit} style={{ marginTop: 10 }}>
      <Field label="Full name"><input value={form.full_name} onChange={set("full_name")} required /></Field>
      <Field label="Relationship"><Select value={form.relationship} onChange={set("relationship")} options={RELATIONS.map((value) => ({ value, label: value }))} /></Field>
      <Field label="Date of birth"><input type="date" value={form.date_of_birth} onChange={set("date_of_birth")} /></Field>
      <div className="check-group">
        <label className="check"><input type="checkbox" checked={form.disability} onChange={set("disability")} /> {t("Disability or access need")}</label>
      </div>
      <ErrorText>{error}</ErrorText>
      <Button type="submit">Save</Button>
      <span className="small muted">{t("Family")}</span>
    </form>
  );
}

export function PassportPage() {
  const { t } = useI18n();
  const home = useData("/home");
  const profiles = home.data?.profiles || [];
  const [profileId, setProfileId] = useState(null);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("profile");
    if (query) setProfileId(Number(query));
    else if (profiles[0] && !profileId) setProfileId(profiles[0].id);
  }, [profiles, profileId]);
  const passport = useData(profileId ? `/profiles/${profileId}/passport` : null);
  const [tab, setTab] = useState("all");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const entries = (passport.data?.entries || []).filter((entry) => tab === "all" || entry.entry_type === tab || (tab === "records" && ["lab", "report", "operation", "note"].includes(entry.entry_type)));

  async function savePhone() {
    const data = await api(`/profiles/${profileId}/emergency-summary`);
    saveOffline(data.summary);
    setSaved(true);
  }

  return (
    <div className="stack">
      <div className="spread">
        <h1>{t("Health passport")}</h1>
        <Link className="text-btn" to="/lookup">{t("Find by ID")}</Link>
      </div>
      <Picker profiles={profiles} current={profileId} onChange={setProfileId} />
      {home.data && profiles.length === 0 && <p className="muted">{t("No family profiles yet.")} <Link to="/home">{t("Add a family member")}</Link></p>}
      <ErrorText>{home.error || passport.error || error}</ErrorText>
      {passport.data && (
        <>
          <div className="spread">
            <div>
              <h2>{passport.data.profile.full_name}</h2>
              <p className="passport-id">{t("ID")} {passport.data.profile.passport_id}</p>
              <p className="small muted">{[passport.data.profile.shelter_name, passport.data.profile.blood_type || t("Blood type not set")].filter(Boolean).join(" · ")}</p>
            </div>
            <Pill value={passport.data.profile.criticality.level}>{passport.data.profile.criticality.confirmed ? "Confirmed" : "Suggested"} {passport.data.profile.criticality.level}</Pill>
          </div>
          <div className="segment" style={{ overflowX: "auto" }}>
            {[["all", "All"], ["condition", "Conditions"], ["medication", "Medications"], ["records", "Records"], ["vaccine", "Vaccines"]].map(([value, label]) => (
              <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{t(label)}</button>
            ))}
          </div>
          <div className="card">
            {entries.map((entry) => <EntryRow key={entry.id} entry={entry} onChanged={passport.reload} />)}
            {entries.length === 0 && <p className="muted small">No records in this section yet.</p>}
          </div>
          <EntryForm profileId={profileId} onDone={passport.reload} />
          <div className="stack">
            <h3>{t("Emergency card")}</h3>
            <Note>{t("Share the passport ID with a doctor or responder so they can open this passport. The QR opens a short emergency summary.")}</Note>
            <Button type="button" onClick={savePhone}>{saved ? "Saved on this phone" : "Save on this phone"}</Button>
            {saved && <SummaryCard summary={JSON.parse(localStorage.getItem("maak_offline") || "[]")[0]} />}
          </div>
        </>
      )}
    </div>
  );
}

function Picker({ profiles, current, onChange }) {
  return (
    <div className="people-scroll">
      {profiles.map((profile) => (
        <button key={profile.id} type="button" className={`person-chip ${current === profile.id ? "active" : ""}`} onClick={() => onChange(profile.id)}>
          <strong>{profile.full_name.split(" ")[0]}</strong>
          <div className="small muted">{profile.relationship}</div>
        </button>
      ))}
    </div>
  );
}

// Each need the person can pick. `count` says how many things are already recorded.
const NEEDS = [
  { id: "devices", label: "Medical devices and power", hint: "Oxygen, ventilator, other devices", count: (d) => d.dependencies.length },
  { id: "dialysis", label: "Dialysis", hint: "Sessions and open seats", count: (d) => d.dialysis.length },
  { id: "pregnancy", label: "Pregnancy", hint: "Stage, due date, risk", count: (d) => (d.pregnancy ? 1 : 0) },
  { id: "nutrition", label: "Specialized nutrition", hint: "Tube feeding, special diets", count: (d) => d.supplies.filter((s) => s.category === "specialized_nutrition").length },
  { id: "supplies", label: "Food and supplies", hint: "Food, formula, hygiene", count: (d) => d.supplies.filter((s) => s.category !== "specialized_nutrition").length },
];

export function CarePage() {
  const { t } = useI18n();
  const home = useData("/home");
  const profiles = home.data?.profiles || [];
  const [profileId, setProfileId] = useState(null);
  const [need, setNeed] = useState(null);
  useEffect(() => {
    if (profiles[0] && !profileId) setProfileId(profiles[0].id);
  }, [profiles, profileId]);
  const care = useData(profileId ? `/profiles/${profileId}/care` : null);
  const data = care.data;
  const pickPerson = (id) => { setProfileId(id); setNeed(null); };
  return (
    <div className="stack">
      <h1>{t("Care needs")}</h1>
      <Picker profiles={profiles} current={profileId} onChange={pickPerson} />
      {home.data && profiles.length === 0 && <p className="muted">{t("No family profiles yet.")} <Link to="/home">{t("Add a family member")}</Link></p>}
      <ErrorText>{care.error}</ErrorText>
      {data && (
        <>
          <div className={`banner ${data.criticality.level === "critical" ? "rose" : "green"}`}>
            <div className="spread">
              <strong>{data.criticality.confirmed ? t("Confirmed") : t("Not yet confirmed")}</strong>
              <Pill value={data.criticality.level}>{data.criticality.level}</Pill>
            </div>
            <p className="small">{(data.criticality.reasons || []).join(" · ") || "No urgent supply signal."}</p>
            <p className="small muted">{t("Suggested from reported supplies. A coordinator or clinician confirms it.")} {t("This supports a decision. It does not assign care.")}</p>
          </div>

          <section className="stack">
            <h3>{t("What do you need help with?")}</h3>
            <div className="need-grid" role="group" aria-label={t("What do you need help with?")}>
              {NEEDS.map((item) => {
                const count = item.count(data);
                return (
                  <button key={item.id} type="button" className={`need-tile ${need === item.id ? "active" : ""}`} aria-pressed={need === item.id} onClick={() => setNeed(need === item.id ? null : item.id)}>
                    <strong>{t(item.label)}</strong>
                    <span className="small muted">{t(item.hint)}</span>
                    {count > 0 && <Pill value="available">{count} {t("recorded")}</Pill>}
                  </button>
                );
              })}
            </div>
            {!need && <p className="small muted">{t("Choose one to see what is recorded and add information.")}</p>}
          </section>

          {need === "devices" && (
            <>
              <section className="card stack">
                <h3>{t("Medical devices and power")}</h3>
                {data.dependencies.map((item) => (
                  <div key={item.id}>
                    <div className="spread"><strong>{item.device_name || t(DEVICE_KINDS.find((kind) => kind.value === item.kind)?.label || item.kind)}</strong><span>{item.supply_level_percent ?? "—"}%</span></div>
                    <Bars value={item.supply_level_percent || 0} tone={(item.supply_level_percent || 0) < 25 ? "rose" : ""} />
                    <p className="small muted">{item.hours_remaining ?? "—"} {t("Hours left")}</p>
                  </div>
                ))}
                <DependencyForm profileId={profileId} onDone={care.reload} />
              </section>
              <section className="card stack">
                <h3>{t("Shelters with backup power")}</h3>
                {data.backup_shelters.map((shelter) => (
                  <div className="row" key={shelter.id}>
                    <div>
                      <strong>{shelter.name}</strong>
                      <div className="small muted">{shelter.region} · {shelter.electricity_hours}h backup · {shelter.accessible ? "Accessible" : "Not accessible"}</div>
                    </div>
                    <MoveButton
                      profileId={profileId}
                      shelter={shelter}
                      currentShelterId={data.profile.shelter_id}
                      requested={(data.relocations || []).some((item) => item.destination_shelter_id === shelter.id && item.status === "requested")}
                      onDone={care.reload}
                    />
                  </div>
                ))}
              </section>
            </>
          )}

          {need === "dialysis" && (
            <section className="card stack">
              <h3>{t("Dialysis")}</h3>
              {data.dialysis.map((item) => (
                <div className="row" key={item.id}>
                  <div><strong>{item.facility_name}</strong><div className="small muted">{formatWhen(item.scheduled_at)}</div></div>
                  <div className="inline">
                    <Pill value={item.status}>{item.status}</Pill>
                    {item.status !== "missed" && <button className="text-btn" type="button" onClick={async () => { await api(`/dialysis/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: "missed" }) }); care.reload(); }}>{t("Missed")}</button>}
                  </div>
                </div>
              ))}
              <DialysisForm profileId={profileId} onDone={care.reload} />
              <h3>{t("Available seats")}</h3>
              {data.seats.map((seat) => (
                <div className="row" key={seat.id}>
                  <div><strong>{seat.facility_name}</strong><div className="small muted">{seat.region} · {formatWhen(seat.next_opening)}</div></div>
                  <Pill value={seat.seats_available ? "available" : "shortage"}>{seat.seats_available} seats</Pill>
                </div>
              ))}
            </section>
          )}

          {need === "pregnancy" && (
            <section className="card stack">
              <h3>{t("Pregnancy")}</h3>
              {data.pregnancy && (
                <div className="banner amber">
                  <strong>{data.pregnancy.weeks} {t("Weeks")}</strong>
                  <p className="small">{data.pregnancy.risk_level === "high" ? "High-risk" : "Routine"} · {data.pregnancy.risk_notes}</p>
                  <p className="small muted">Next visit {formatWhen(data.pregnancy.next_appointment)}</p>
                </div>
              )}
              <PregnancyForm key={profileId} profileId={profileId} current={data.pregnancy} onDone={care.reload} />
            </section>
          )}

          {(need === "nutrition" || need === "supplies") && (
            <section className="card stack">
              <h3>{t(need === "nutrition" ? "Specialized nutrition" : "Food and supplies")}</h3>
              {data.supplies
                .filter((item) => (need === "nutrition" ? item.category === "specialized_nutrition" : item.category !== "specialized_nutrition"))
                .map((item) => (
                  <div className="row" key={item.id}>
                    <div><strong>{item.item_name}</strong><div className="small muted">{item.category} · {item.quantity_note}</div></div>
                    <Pill value={item.status}>{item.status}</Pill>
                  </div>
                ))}
              <SupplyForm key={need} profileId={profileId} nutrition={need === "nutrition"} onDone={care.reload} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function DependencyForm({ profileId, onDone }) {
  const [form, setForm] = useState({ kind: "oxygen", device_name: "", supply_level_percent: "", hours_remaining: "" });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <form className="stack" onSubmit={async (event) => { event.preventDefault(); await api(`/profiles/${profileId}/dependencies`, { method: "POST", body: JSON.stringify(form) }); onDone(); }}>
      <div className="grid-2">
        <Field label="Device">
          <Select value={form.kind} onChange={set("kind")} options={DEVICE_KINDS} />
        </Field>
        <Field label={form.kind === "other" ? "Which device?" : "Device name (optional)"}>
          <input placeholder={form.kind === "other" ? "e.g. CPAP machine" : "e.g. Philips concentrator"} value={form.device_name} onChange={set("device_name")} required={form.kind === "other"} />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Supply percent"><input type="number" value={form.supply_level_percent} onChange={set("supply_level_percent")} /></Field>
        <Field label="Hours left"><input type="number" value={form.hours_remaining} onChange={set("hours_remaining")} /></Field>
      </div>
      <Button type="submit">Add dependency</Button>
    </form>
  );
}

function MoveButton({ profileId, shelter, currentShelterId, requested, onDone }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (currentShelterId === shelter.id) return <Pill value="available">{t("You are here")}</Pill>;
  async function request() {
    setBusy(true);
    setError("");
    try {
      await api("/relocations", {
        method: "POST",
        body: JSON.stringify({ profile_id: profileId, destination_shelter_id: shelter.id, reason: `Needs backup power at ${shelter.name}` }),
      });
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack" style={{ alignItems: "flex-end" }}>
      <button className="btn-soft" type="button" disabled={busy || requested} onClick={request}>
        {requested ? t("Move requested") : busy ? t("Sending…") : t("Request a move")}
      </button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function DialysisForm({ profileId, onDone }) {
  const [form, setForm] = useState({ facility_name: "", scheduled_at: "", status: "scheduled" });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <form className="grid-2" onSubmit={async (e) => { e.preventDefault(); await api(`/profiles/${profileId}/dialysis`, { method: "POST", body: JSON.stringify(form) }); onDone(); }}>
      <Field label="Facility"><input value={form.facility_name} onChange={set("facility_name")} required /></Field>
      <Field label="Date"><input type="datetime-local" value={form.scheduled_at} onChange={set("scheduled_at")} required /></Field>
      <Button type="submit">Save</Button>
    </form>
  );
}

function SupplyForm({ profileId, nutrition, onDone }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ item_name: "", category: nutrition ? "specialized_nutrition" : "food", quantity_note: "", status: "shortage" });
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      await api(`/profiles/${profileId}/supplies`, { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, item_name: "", quantity_note: "" });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <Field label={nutrition ? "What food or feeding supply?" : "Item"}>
        <input placeholder={nutrition ? "e.g. Tube feeding formula" : "e.g. Baby formula"} value={form.item_name} onChange={set("item_name")} required />
      </Field>
      <div className="grid-2">
        {!nutrition && (
          <Field label="Category">
            <Select value={form.category} onChange={set("category")} options={["food", "formula", "sanitary", "other"].map((value) => ({ value, label: value }))} />
          </Field>
        )}
        <Field label="Status">
          <Select value={form.status} onChange={set("status")} options={["ok", "low", "shortage"].map((value) => ({ value, label: value }))} />
        </Field>
      </div>
      <Field label="How much is left?"><input placeholder="e.g. 2 days" value={form.quantity_note} onChange={set("quantity_note")} /></Field>
      <ErrorText>{error}</ErrorText>
      <Button type="submit">Report a shortage</Button>
    </form>
  );
}

function PregnancyForm({ profileId, current, onDone }) {
  const [form, setForm] = useState({
    weeks: current?.weeks || "",
    due_date: current?.due_date || "",
    risk_level: current?.risk_level || "routine",
    risk_notes: current?.risk_notes || "",
    next_appointment: current?.next_appointment ? current.next_appointment.slice(0, 16) : "",
  });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <form className="stack" onSubmit={async (e) => { e.preventDefault(); await api(`/profiles/${profileId}/pregnancy`, { method: "PUT", body: JSON.stringify(form) }); onDone(); }}>
      <div className="grid-2">
        <Field label="Weeks"><input type="number" value={form.weeks} onChange={set("weeks")} required /></Field>
        <Field label="Due date"><input type="date" value={form.due_date?.slice?.(0, 10) || form.due_date} onChange={set("due_date")} /></Field>
      </div>
      <Field label="Status">
        <Select value={form.risk_level} onChange={set("risk_level")} options={[{ value: "routine", label: "Routine" }, { value: "high", label: "High-risk" }]} />
      </Field>
      <Field label="High-risk notes"><input value={form.risk_notes} onChange={set("risk_notes")} /></Field>
      <Field label="Date"><input type="datetime-local" value={form.next_appointment} onChange={set("next_appointment")} /></Field>
      <Button type="submit">Save</Button>
    </form>
  );
}

export function RequestsPage() {
  const { t } = useI18n();
  const { data, error, reload } = useData("/requests/mine");
  useEffect(() => {
    if (data && window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView({ behavior: "smooth" });
  }, [Boolean(data)]);
  return (
    <div className="stack">
      <h1>{t("Requests")}</h1>
      <ErrorText>{error}</ErrorText>
      {data && (
        <>
          <DonationRequestSection profiles={data.profiles} />
          <section className="card stack">
            <h3>{t("Appointments at risk")}</h3>
            {data.appointments.filter((item) => data.at_risk_appointment_ids.includes(item.id)).map((item) => (
              <div className="row" key={item.id}>
                <div><strong>{item.who}</strong><div className="small muted">{item.facility} · {formatWhen(item.scheduled_at)}</div></div>
                <Pill value="requested">No ride yet</Pill>
              </div>
            ))}
            {data.at_risk_appointment_ids.length === 0 && <p className="small muted">No appointment is waiting on transport.</p>}
            <AppointmentForm profiles={data.profiles} onDone={reload} />
          </section>
          <section className="card stack">
            <h3>{t("Transport")}</h3>
            {data.transports.map((item) => (
              <div className="row" key={item.id}>
                <div>
                  <strong>{item.who} → {item.destination}</strong>
                  <div className="small muted">{item.destination_type}{item.wheelchair_required ? " · wheelchair" : ""}</div>
                </div>
                <Pill value={item.status}>{item.status}</Pill>
              </div>
            ))}
            <TransportForm profiles={data.profiles} appointments={data.appointments} onDone={reload} />
          </section>
          <section className="card stack">
            <h3>{t("Mental health support")}</h3>
            <Note>A flag asks for a human follow-up. It is not a diagnosis.</Note>
            {data.flags.map((item) => (
              <div className="row" key={item.id}>
                <div><strong>{item.who}</strong><div className="small">{item.reason}</div></div>
                <Pill value={item.status}>{item.status}</Pill>
              </div>
            ))}
            <FlagForm profiles={data.profiles} onDone={reload} />
          </section>
          <section className="card stack">
            <h3>{t("Add a complaint")}</h3>
            {data.complaints.map((item) => (
              <div className="row" key={item.id}>
                <div><strong>{item.category}</strong><div className="small muted">{item.shelter_name} · {item.source}</div><div className="small">{item.description}</div></div>
                <Pill value={item.status}>{item.status}</Pill>
              </div>
            ))}
            <ComplaintForm onDone={reload} />
          </section>
        </>
      )}
    </div>
  );
}

const REQUEST_CATEGORIES = [
  ["food", "Food"], ["medicine", "Medicine"], ["baby", "Baby needs"], ["hygiene", "Hygiene"],
  ["blankets", "Blankets and heating"], ["clothes", "Clothes"], ["rent", "Help with rent"], ["other", "Other"],
];

const REGION_NAMES = ["Beirut", "Mount Lebanon", "North", "Akkar", "Bekaa", "Baalbek-Hermel", "South", "Nabatieh"];

// For displaced families outside the shelters (tents, renting, host families...).
function DonationRequestSection({ profiles }) {
  const { t } = useI18n();
  const mine = useData("/donation-requests/mine");
  const blank = { living_situation: "tent", region: "", area: "", category: "food", description: "", people_count: "", profile_id: "" };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      await api("/donation-requests", { method: "POST", body: JSON.stringify({ ...form, profile_id: form.profile_id || null }) });
      setForm(blank);
      setSent(true);
      setOpen(false);
      mine.reload();
    } catch (err) {
      setError(err.message);
    }
  }
  async function act(path, body) {
    try {
      await api(path, { method: body ? "PATCH" : "POST", body: JSON.stringify(body || {}) });
      mine.reload();
    } catch (err) {
      setError(err.message);
    }
  }
  const requests = mine.data?.requests || [];
  return (
    <section className="card stack" id="donations">
      <div className="spread">
        <h3>{t("Ask for donations")}</h3>
        {!open && <Button type="button" soft onClick={() => { setOpen(true); setSent(false); }}>New request</Button>}
      </div>
      <p className="small muted">{t("Not in a shelter? If you live in a tent, rent, or stay with a host family, donors can still help you.")}</p>
      {sent && <div className="banner green small">{t("Your request is now visible to donors.")}</div>}
      {open && (
        <form className="stack" onSubmit={submit}>
          <Field label="Where are you staying?">
            <Select value={form.living_situation} onChange={set("living_situation")} options={LIVING_SITUATIONS.map(([value, label]) => ({ value, label }))} />
          </Field>
          <div className="grid-2">
            <Field label="Region">
              <select value={form.region} onChange={set("region")} required>
                <option value="">—</option>
                {REGION_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </Field>
            <Field label="Town or area"><input value={form.area} onChange={set("area")} placeholder={t("e.g. Saida, Old City")} /></Field>
            <Field label="What do you need?">
              <Select value={form.category} onChange={set("category")} options={REQUEST_CATEGORIES.map(([value, label]) => ({ value, label }))} />
            </Field>
            <Field label="People in your family"><input type="number" min="1" value={form.people_count} onChange={set("people_count")} /></Field>
          </div>
          {profiles.length > 0 && (
            <Field label="For a family member (optional)">
              <select value={form.profile_id} onChange={set("profile_id")}>
                <option value="">{t("The whole family")}</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Describe what you need"><textarea rows={3} maxLength={500} value={form.description} onChange={set("description")} required /></Field>
          <p className="small muted">{t("Do not write your exact address. A donor or volunteer will arrange delivery with you.")}</p>
          <ErrorText>{error}</ErrorText>
          <div className="action-row">
            <Button type="button" ghost onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit">Send request</Button>
          </div>
        </form>
      )}
      {requests.map((req) => (
        <div className="card stack" key={req.id}>
          <div className="spread">
            <strong>{t(REQUEST_CATEGORIES.find(([v]) => v === req.category)?.[1] || req.category)}</strong>
            <Pill value={req.status === "open" ? "open" : "resolved"}>{t(req.status === "open" ? "Open" : req.status === "fulfilled" ? "Fulfilled" : "Closed")}</Pill>
          </div>
          <p className="small">{req.description}</p>
          <p className="small muted">{[t(LIVING_SITUATIONS.find(([v]) => v === req.living_situation)?.[1]), req.area, req.region].filter(Boolean).join(" · ")}</p>
          {req.donations.length === 0 && <p className="small muted">{t("No donations yet.")}</p>}
          {req.donations.map((gift) => (
            <div className="row" key={gift.id}>
              <div><strong>{gift.kind === "money" ? `${gift.amount} ${gift.currency}` : gift.item_description}</strong><div className="small muted">{gift.donor_name}</div></div>
              {gift.status === "pledged"
                ? <Button type="button" soft onClick={() => act(`/donations/${gift.id}/received`)}>I received it</Button>
                : <Pill value="received">{t("Received")}</Pill>}
            </div>
          ))}
          {req.status === "open" && (
            <div className="action-row">
              <Button type="button" ghost onClick={() => act(`/donation-requests/${req.id}`, { status: "closed" })}>Close request</Button>
              <Button type="button" soft onClick={() => act(`/donation-requests/${req.id}`, { status: "fulfilled" })}>My needs are met</Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function AppointmentForm({ profiles, onDone }) {
  const [form, setForm] = useState({ profile_id: profiles[0]?.id || "", facility: "", scheduled_at: "", kind: "clinic" });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <form className="stack" onSubmit={async (e) => { e.preventDefault(); await api("/appointments", { method: "POST", body: JSON.stringify({ ...form, profile_id: Number(form.profile_id) }) }); onDone(); }}>
      <PersonSelect profiles={profiles} value={form.profile_id} onChange={set("profile_id")} />
      <Field label="Facility"><input value={form.facility} onChange={set("facility")} required /></Field>
      <Field label="Date"><input type="datetime-local" value={form.scheduled_at} onChange={set("scheduled_at")} required /></Field>
      <Button type="submit">Save</Button>
    </form>
  );
}

function TransportForm({ profiles, appointments, onDone }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ profile_id: profiles[0]?.id || "", destination: "", destination_type: "hospital", wheelchair_required: false, appointment_id: "" });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      await api("/transport", { method: "POST", body: JSON.stringify({ ...form, profile_id: Number(form.profile_id), appointment_id: form.appointment_id ? Number(form.appointment_id) : null }) });
      onDone();
    }}>
      <PersonSelect profiles={profiles} value={form.profile_id} onChange={set("profile_id")} />
      <Field label="Destination"><input value={form.destination} onChange={set("destination")} required /></Field>
      <Field label="Type">
        <Select value={form.destination_type} onChange={set("destination_type")} options={["hospital", "dialysis", "clinic", "other"].map((value) => ({ value, label: value }))} />
      </Field>
      <Field label="Link an appointment">
        <select value={form.appointment_id} onChange={set("appointment_id")}>
          <option value="">None</option>
          {appointments.filter((item) => String(item.profile_id) === String(form.profile_id)).map((item) => (
            <option key={item.id} value={item.id}>{item.facility} · {formatWhen(item.scheduled_at)}</option>
          ))}
        </select>
      </Field>
      <div className="check-group">
        <label className="check"><input type="checkbox" checked={form.wheelchair_required} onChange={set("wheelchair_required")} /> {t("Wheelchair access")}</label>
      </div>
      <Button type="submit">Request transport</Button>
    </form>
  );
}

function FlagForm({ profiles, onDone }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ profile_id: profiles[0]?.id || "", reason: "", includes_bullying: false });
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  return (
    <form className="stack" onSubmit={async (e) => { e.preventDefault(); await api("/support-flags", { method: "POST", body: JSON.stringify({ ...form, profile_id: Number(form.profile_id) }) }); onDone(); }}>
      <PersonSelect profiles={profiles} value={form.profile_id} onChange={set("profile_id")} />
      <Field label="Reason"><textarea value={form.reason} onChange={set("reason")} required /></Field>
      <div className="check-group">
        <label className="check"><input type="checkbox" checked={form.includes_bullying} onChange={set("includes_bullying")} /> {t("Includes bullying")}</label>
      </div>
      <Button type="submit">Flag for support</Button>
    </form>
  );
}

function PersonSelect({ profiles, value, onChange }) {
  return (
    <Field label="Family">
      <select value={value} onChange={onChange}>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name}</option>)}
      </select>
    </Field>
  );
}

const FAMILY = ["caregiver"];

// [path, page, roles allowed] — added to the app by src/roles.js
export const ROUTES = [
  ["/home", HomePage, FAMILY],
  ["/passport", PassportPage, FAMILY],
  ["/care", CarePage, FAMILY],
  ["/requests", RequestsPage, FAMILY],
];
