// Shelter pages. Picked up automatically from src/roles/ (see src/roles.js).
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatWhen } from "../api";
import { useAuth, useI18n } from "../context";
import { ComplaintBoard, CriticalityControl, HistoryTable, money, NoticesManager, PageTitle, Stat, STATUS_LABELS, StatusPill, StatusSelect, TASK_KIND_LABELS, useAction, useData, useForm } from "../shared";
import { Bars, Button, Empty, ErrorText, Field, Note, Select } from "../ui";

/* ------------------------------------------------------------------ */
/* Shelter coordinator — all pages share /shelter/board                */
/* ------------------------------------------------------------------ */

function useShelterBoard() {
  return useData("/shelter/board");
}

function ShelterFrame({ title, sub, children }) {
  const board = useShelterBoard();
  return (
    <div className="stack">
      <PageTitle sub={sub}>{title}</PageTitle>
      <ErrorText>{board.error}</ErrorText>
      {board.error && board.error.includes("Choose the shelter") && <ChooseShelter />}
      {board.data && children(board.data, board.reload)}
    </div>
  );
}

function ChooseShelter() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const { data } = useData("/shelters");
  const [id, setId] = useState("");
  const { run, error } = useAction();
  async function save(e) {
    e.preventDefault();
    const result = await run(`/users/${user.id}/shelter`, "PATCH", { shelter_id: Number(id) });
    if (result) { refresh(result.user); window.location.reload(); }
  }
  return (
    <form className="card stack" onSubmit={save}>
      <h3>{t("Which shelter do you coordinate?")}</h3>
      <select value={id} onChange={(e) => setId(e.target.value)} required>
        <option value="">—</option>
        {(data?.shelters || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <ErrorText>{error}</ErrorText>
      <Button type="submit">Save</Button>
    </form>
  );
}

export function ShelterOverviewPage() {
  const { t } = useI18n();
  return (
    <ShelterFrame title="Overview">
      {(data, reload) => <ShelterOverview data={data} reload={reload} t={t} />}
    </ShelterFrame>
  );
}

function ShelterOverview({ data, reload, t }) {
  const { shelter, stats } = data;
  const [form, set] = useForm({
    capacity: shelter.capacity, occupancy: shelter.occupancy, accessible_spaces: shelter.accessible_spaces ?? 0,
    electricity_hours: shelter.electricity_hours ?? 0, accessible: shelter.accessible, has_backup_power: shelter.has_backup_power,
  });
  const update = useAction(reload);
  const [outbreak, setOutbreak, resetOutbreak] = useForm({ suspected_illness: "", case_count: 1, notes: "" });
  const report = useAction(reload);
  const relocation = useAction(reload);
  return (
    <>
      <h2>{shelter.name}</h2>
      <p className="muted">{shelter.region}</p>
      <div className="stat-grid">
        <Stat value={`${stats.percent}%`} label="Occupancy" tone={stats.overcrowded ? "rose" : ""} />
        <Stat value={stats.shortages} label="Shortages" tone={stats.shortages ? "rose" : ""} />
        <Stat value={stats.critical_residents} label="Critical residents" />
        <Stat value={stats.open_complaints} label="Open complaints" />
      </div>
      <Bars value={shelter.occupancy} max={shelter.capacity || 1} tone={stats.overcrowded ? "rose" : ""} />
      <p className="small muted">{shelter.occupancy} / {shelter.capacity} {t("residents")}{stats.overcrowded ? ` · ${t("Overcrowded")}` : ""}</p>

      <form className="card stack" onSubmit={(e) => { e.preventDefault(); update.run(`/shelters/${shelter.id}`, "PATCH", form); }}>
        <h3>{t("Update shelter")}</h3>
        <div className="grid-2">
          <Field label="Capacity"><input type="number" min="0" value={form.capacity} onChange={set("capacity")} /></Field>
          <Field label="Occupancy"><input type="number" min="0" value={form.occupancy} onChange={set("occupancy")} /></Field>
          <Field label="Accessible spaces"><input type="number" min="0" value={form.accessible_spaces} onChange={set("accessible_spaces")} /></Field>
          <Field label="Backup power (hours/day)"><input type="number" min="0" max="24" value={form.electricity_hours} onChange={set("electricity_hours")} /></Field>
        </div>
        <fieldset className="check-group">
          <legend>{t("Facilities")}</legend>
          <label className="check"><input type="checkbox" checked={form.accessible} onChange={set("accessible")} /> {t("Wheelchair accessible")}</label>
          <label className="check"><input type="checkbox" checked={form.has_backup_power} onChange={set("has_backup_power")} /> {t("Has backup power")}</label>
        </fieldset>
        <ErrorText>{update.error}</ErrorText>
        <Button type="submit" disabled={update.busy}>Save</Button>
      </form>

      <section className="card stack">
        <h3>{t("Patient move requests")}</h3>
        <ErrorText>{relocation.error}</ErrorText>
        {data.relocations.length === 0 && <Empty>{t("No move requests.")}</Empty>}
        {data.relocations.map((item) => (
          <div className="row" key={item.id}>
            <div><strong>{item.who}</strong> → {item.destination_name || t("Any suitable facility")}<div className="small">{item.reason}</div></div>
            <StatusSelect value={item.status} options={["requested", "escalated", "resolved"]} onChange={(status) => relocation.run(`/relocations/${item.id}`, "PATCH", { status })} />
          </div>
        ))}
      </section>

      <section className="card stack">
        <h3>{t("Outbreak reports")}</h3>
        <Note>{t("This flags a cluster for public health staff. It does not declare an outbreak.")}</Note>
        {data.outbreaks.map((item) => (
          <div className="row" key={item.id}>
            <div><strong>{item.suspected_illness}</strong><div className="small muted">{item.case_count} {t("cases")} · {formatWhen(item.created_at)}</div></div>
            <StatusPill value={item.status} />
          </div>
        ))}
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (await report.run("/outbreaks", "POST", outbreak)) resetOutbreak(); }}>
          <div className="grid-2">
            <Field label="Suspected illness"><input value={outbreak.suspected_illness} onChange={setOutbreak("suspected_illness")} required /></Field>
            <Field label="Number of cases"><input type="number" min="1" value={outbreak.case_count} onChange={setOutbreak("case_count")} /></Field>
          </div>
          <Field label="Notes"><input value={outbreak.notes} onChange={setOutbreak("notes")} /></Field>
          <ErrorText>{report.error}</ErrorText>
          <Button type="submit" soft disabled={report.busy}>Report a cluster</Button>
        </form>
      </section>
    </>
  );
}

export function ShelterResidentsPage() {
  const { t } = useI18n();
  return (
    <ShelterFrame title="Residents" sub="Criticality is suggested from reported needs. You confirm it.">
      {(data, reload) => <ResidentTable rows={data.residents} reload={reload} t={t} />}
    </ShelterFrame>
  );
}

function ResidentTable({ rows, reload, t }) {
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{t("Name")}</th><th>{t("Passport ID")}</th><th>{t("Age")}</th><th>{t("Status")}</th><th>{t("Change status")}</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><Link to={`/lookup?id=${row.passport_id}`}>{row.full_name}</Link>{row.disability ? <div className="small muted">{t("Disability or access need")}</div> : null}</td>
                <td className="mono small">{row.passport_id}</td>
                <td>{row.age ?? "—"}</td>
                <td><StatusPill value={row.criticality.level} />{!row.criticality.confirmed && <div className="small muted">{t("Suggested")}</div>}</td>
                <td><CriticalityControl key={`${row.id}-${row.criticality.level}`} profile={row} onChanged={reload} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <Empty>{t("No residents registered yet.")}</Empty>}
    </div>
  );
}

function InventoryRow({ item, reload }) {
  const { t } = useI18n();
  const action = useAction(reload);
  const [qty, setQty] = useState(item.quantity);
  return (
    <tr>
      <td><strong>{item.item_name}</strong><div className="small muted">{item.category}{item.is_equipment ? ` · ${t("Equipment")}` : ""}{item.is_specialized ? ` · ${t("Specialized")}` : ""}</div><ErrorText>{action.error}</ErrorText></td>
      <td>
        <form className="inline" onSubmit={(e) => { e.preventDefault(); action.run(`/inventory/${item.id}`, "PATCH", { quantity: qty }); }}>
          <input aria-label={t("Quantity")} type="number" min="0" style={{ width: 80 }} value={qty} onChange={(e) => setQty(e.target.value)} />
          <span className="small muted">{item.unit}</span>
        </form>
      </td>
      <td><StatusSelect value={item.status} options={["available", "low", "shortage"]} onChange={(status) => action.run(`/inventory/${item.id}`, "PATCH", { status })} /></td>
      <td><button className="text-btn" type="button" onClick={() => action.run(`/inventory/${item.id}`, "DELETE")}>{t("Remove")}</button></td>
    </tr>
  );
}

function InventoryTable({ items, reload }) {
  const { t } = useI18n();
  if (items.length === 0) return <Empty>{t("Nothing recorded yet.")}</Empty>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>{t("Item")}</th><th>{t("Quantity")}</th><th>{t("Status")}</th><th /></tr></thead>
        <tbody>{items.map((item) => <InventoryRow key={item.id} item={item} reload={reload} />)}</tbody>
      </table>
    </div>
  );
}

function AddInventory({ shelterId, reload }) {
  const { t } = useI18n();
  const blank = { item_name: "", category: "medication", quantity: 0, unit: "units", status: "available", is_equipment: false, is_specialized: false };
  const [form, set, reset] = useForm(blank);
  const action = useAction(reload);
  return (
    <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if (await action.run(`/shelters/${shelterId}/inventory`, "POST", { ...form, is_equipment: form.is_equipment || form.category === "equipment" })) reset(); }}>
      <h3>{t("Add item")}</h3>
      <div className="grid-2">
        <Field label="Item"><input value={form.item_name} onChange={set("item_name")} placeholder={t("e.g. Baby formula or Hospital bed")} required /></Field>
        <Field label="Category">
          <Select value={form.category} onChange={set("category")} options={[
            { value: "medication", label: "Medication" }, { value: "baby_formula", label: "Baby formula" }, { value: "sanitary", label: "Sanitary products" },
            { value: "food", label: "Food" }, { value: "equipment", label: "Medical equipment" }, { value: "other", label: "Other" },
          ]} />
        </Field>
        <Field label="Quantity"><input type="number" min="0" value={form.quantity} onChange={set("quantity")} /></Field>
        <Field label="Unit"><input value={form.unit} onChange={set("unit")} placeholder={t("e.g. boxes, pens, beds")} /></Field>
        <Field label="Status"><Select value={form.status} onChange={set("status")} options={["available", "low", "shortage"].map((value) => ({ value, label: STATUS_LABELS[value] }))} /></Field>
      </div>
      <fieldset className="check-group">
        <legend>{t("Type")}</legend>
        <label className="check"><input type="checkbox" checked={form.is_equipment || form.category === "equipment"} onChange={set("is_equipment")} /> {t("Medical equipment")}</label>
        <label className="check"><input type="checkbox" checked={form.is_specialized} onChange={set("is_specialized")} /> {t("For elderly or medically vulnerable residents")}</label>
      </fieldset>
      <ErrorText>{action.error}</ErrorText>
      <Button type="submit" disabled={action.busy}>Add item</Button>
    </form>
  );
}

const SUPPLY_FILTERS = [
  ["all", "All items"],
  ["missing", "Low or missing"],
  ["equipment", "Medical equipment"],
];

// Supplies and shortages on one page, with filters.
export function ShelterSuppliesPage() {
  const startOnShortages = window.location.pathname.endsWith("/shortages");
  return (
    <ShelterFrame title="Supplies and shortages" sub="Medication, baby formula, sanitary products, food, and medical equipment.">
      {(data, reload) => <SupplyBoard data={data} reload={reload} initial={startOnShortages ? "missing" : "all"} />}
    </ShelterFrame>
  );
}

function SupplyBoard({ data, reload, initial }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState(initial);
  const items = data.inventory;
  const missing = items.filter((i) => i.status !== "available");
  const shown = filter === "missing" ? missing : filter === "equipment" ? items.filter((i) => i.is_equipment) : items;
  return (
    <>
      <div className="stat-grid">
        <Stat value={items.length} label="Items" />
        <Stat value={items.filter((i) => i.status === "low").length} label="Low" />
        <Stat value={items.filter((i) => i.status === "shortage").length} label="Shortage" tone={items.some((i) => i.status === "shortage") ? "rose" : ""} />
        <Stat value={items.filter((i) => i.is_equipment).length} label="Medical equipment" />
      </div>
      <div className="chip-row" role="group" aria-label={t("Show")}>
        {SUPPLY_FILTERS.map(([value, label]) => (
          <button key={value} type="button" className={`chip ${filter === value ? "active" : ""}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {t(label)}{value === "missing" && missing.length ? ` (${missing.length})` : ""}
          </button>
        ))}
      </div>
      <section className="card"><InventoryTable items={shown} reload={reload} /></section>
      <AddInventory shelterId={data.shelter.id} reload={reload} />
    </>
  );
}

export function ShelterExchangePage() {
  const { t } = useI18n();
  return (
    <ShelterFrame title="Exchange" sub="Send extra supplies to shelters that are short.">
      {(data, reload) => <Exchange data={data} reload={reload} t={t} />}
    </ShelterFrame>
  );
}

function Exchange({ data, reload, t }) {
  const shelters = useData("/shelters");
  const [form, set, reset] = useForm({ to_shelter_id: "", item_name: "", quantity: 1, needs_volunteer: true });
  const create = useAction(reload);
  const update = useAction(reload);
  const others = (shelters.data?.shelters || []).filter((s) => s.id !== data.shelter.id);
  const short = others.filter((s) => s.shortage_names.length);
  return (
    <>
      {short.length > 0 && (
        <section className="card stack">
          <h3>{t("Shelters reporting shortages")}</h3>
          {short.map((s) => <div className="row" key={s.id}><strong>{s.name}</strong><span className="small">{s.shortage_names.join(", ")}</span></div>)}
        </section>
      )}
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if (await create.run("/exchanges", "POST", { ...form, to_shelter_id: Number(form.to_shelter_id) })) reset(); }}>
        <h3>{t("Offer supplies to another shelter")}</h3>
        <Field label="Send to">
          <select value={form.to_shelter_id} onChange={set("to_shelter_id")} required>
            <option value="">—</option>
            {others.map((s) => <option key={s.id} value={s.id}>{s.name}{s.shortage_names.length ? ` (${t("short")}: ${s.shortage_names.join(", ")})` : ""}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Item"><input value={form.item_name} onChange={set("item_name")} required /></Field>
          <Field label="Quantity"><input type="number" min="1" value={form.quantity} onChange={set("quantity")} /></Field>
        </div>
        <div className="check-group">
          <label className="check"><input type="checkbox" checked={form.needs_volunteer} onChange={set("needs_volunteer")} /> {t("Ask a volunteer to deliver it")}</label>
        </div>
        <ErrorText>{create.error}</ErrorText>
        <Button type="submit" disabled={create.busy}>Propose exchange</Button>
      </form>
      <section className="card stack">
        <h3>{t("Exchanges")}</h3>
        <ErrorText>{update.error}</ErrorText>
        {data.exchanges.length === 0 && <Empty>{t("No exchanges yet.")}</Empty>}
        {data.exchanges.map((item) => (
          <div className="row" key={item.id}>
            <div><strong>{item.quantity} × {item.item_name}</strong><div className="small muted">{item.from_shelter_name} → {item.to_shelter_name}{item.needs_volunteer ? ` · ${t("volunteer delivery")}` : ""}</div></div>
            <StatusSelect value={item.status} options={["proposed", "accepted", "in_transit", "completed"]} onChange={(status) => update.run(`/exchanges/${item.id}`, "PATCH", { status })} />
          </div>
        ))}
      </section>
    </>
  );
}

export function ShelterDonationsPage() {
  const { t } = useI18n();
  return (
    <ShelterFrame title="Donations" sub="Confirm gifts when they arrive and when they are given out.">
      {(data, reload) => <ShelterDonations rows={data.donations} reload={reload} t={t} />}
    </ShelterFrame>
  );
}

function ShelterDonations({ rows, reload, t }) {
  const action = useAction(reload);
  return (
    <section className="card">
      <ErrorText>{action.error}</ErrorText>
      {rows.length === 0 && <Empty>{t("No donations for this shelter yet.")}</Empty>}
      {rows.map((item) => (
        <div className="row" key={item.id}>
          <div><strong>{item.kind === "money" ? money(item.amount, item.currency) : item.item_description}</strong><div className="small muted">{item.donor_name}{item.cause_label ? ` · ${item.cause_label}` : ""}</div></div>
          <StatusSelect value={item.status} options={["pledged", "received", "allocated", "distributed"]} onChange={(status) => action.run(`/donations/${item.id}`, "PATCH", { status })} />
        </div>
      ))}
    </section>
  );
}

export function ShelterVolunteersPage() {
  const { t } = useI18n();
  return (
    <ShelterFrame title="Volunteers" sub="Post tasks for volunteers and announce doctor visits.">
      {(data, reload) => <ShelterVolunteers data={data} reload={reload} t={t} />}
    </ShelterFrame>
  );
}

function ShelterVolunteers({ data, reload, t }) {
  const [task, setTask, resetTask] = useForm({ kind: "delivery", title: "", details: "", location: "", scheduled_at: "" });
  const addTask = useAction(reload);
  return (
    <>
      <section className="card stack">
        <h3>{t("Tasks")}</h3>
        {data.tasks.length === 0 && <Empty>{t("No tasks yet.")}</Empty>}
        {data.tasks.map((item) => (
          <div className="row" key={item.id}>
            <div><strong>{item.title}</strong><div className="small muted">{[t(TASK_KIND_LABELS[item.kind] || item.kind), item.assignee_name, formatWhen(item.scheduled_at)].filter(Boolean).join(" · ")}</div></div>
            <StatusPill value={item.status} />
          </div>
        ))}
      </section>
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if (await addTask.run("/tasks", "POST", task)) resetTask(); }}>
        <h3>{t("Post a volunteer task")}</h3>
        <Field label="Type"><Select value={task.kind} onChange={setTask("kind")} options={Object.entries(TASK_KIND_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Title"><input value={task.title} onChange={setTask("title")} required /></Field>
        <Field label="Details"><textarea value={task.details} onChange={setTask("details")} /></Field>
        <div className="grid-2">
          <Field label="Location"><input value={task.location} onChange={setTask("location")} /></Field>
          <Field label="Date"><input type="datetime-local" value={task.scheduled_at} onChange={setTask("scheduled_at")} /></Field>
        </div>
        <ErrorText>{addTask.error}</ErrorText>
        <Button type="submit" disabled={addTask.busy}>Post task</Button>
      </form>
      <NoticesManager scope="own-shelter" />
    </>
  );
}

export function ShelterComplaintsPage() {
  const { t } = useI18n();
  return (
    <ShelterFrame title="Complaints">
      {(data, reload) => <ComplaintBoard rows={data.complaints} reload={reload} t={t} />}
    </ShelterFrame>
  );
}

function downloadReport(name, history) {
  const header = "Month,Shortages,Occupancy,Complaints,Critical residents";
  const lines = history.map((r) => [r.month, r.shortages, r.occupancy, r.complaints, r.critical].join(","));
  const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name.replace(/\W+/g, "-")}-monthly-report.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function ShelterReportsPage() {
  const { t } = useI18n();
  return (
    <ShelterFrame title="Monthly report" sub="Shortages, occupancy, complaints and critical residents, month by month.">
      {(data) => (
        <section className="card stack">
          <div className="spread">
            <h3>{data.shelter.name}</h3>
            <Button type="button" soft onClick={() => downloadReport(data.shelter.name, data.history.history)}>Download CSV</Button>
          </div>
          <Note>{t("The app makes this report automatically from your shelter's data. The current month keeps updating until it ends, then it is saved as history.")}</Note>
          <HistoryTable history={data.history.history} />
          <p className="small muted">{t("Trend")}: {t(data.history.trend || "stable")}</p>
        </section>
      )}
    </ShelterFrame>
  );
}

const SHELTER = ["shelter_coordinator"];

// [path, page, roles allowed] — added to the app by src/roles.js
export const ROUTES = [
  ["/shelter", ShelterOverviewPage, SHELTER],
  ["/shelter/residents", ShelterResidentsPage, SHELTER],
  ["/shelter/supplies", ShelterSuppliesPage, SHELTER],
  ["/shelter/shortages", ShelterSuppliesPage, SHELTER],
  ["/shelter/exchange", ShelterExchangePage, SHELTER],
  ["/shelter/donations", ShelterDonationsPage, SHELTER],
  ["/shelter/volunteers", ShelterVolunteersPage, SHELTER],
  ["/shelter/complaints", ShelterComplaintsPage, SHELTER],
  ["/shelter/reports", ShelterReportsPage, SHELTER],
];
