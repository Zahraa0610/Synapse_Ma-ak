// Ministry pages. Picked up automatically from src/roles/ (see src/roles.js).
import { useState } from "react";
import { formatWhen } from "../api";
import { useI18n } from "../context";
import { ComplaintBoard, HistoryTable, money, NoticesManager, PageTitle, REGION_LIST, Stat, StatusPill, StatusSelect, useAction, useData, useForm } from "../shared";
import { Button, Empty, ErrorText, Field, Note, Pill, Select } from "../ui";

export function MinistryNoticesPage() {
  return (
    <div className="stack">
      <PageTitle sub="Announce free check-ups, screening days and vaccination campaigns to families, volunteers and shelters.">Health events</PageTitle>
      <NoticesManager scope="any" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ministry of Public Health                                           */
/* ------------------------------------------------------------------ */

function MinistryFrame({ path, title, sub, children }) {
  const { data, error, reload } = useData(path);
  return (
    <div className="stack">
      <PageTitle sub={sub}>{title}</PageTitle>
      <ErrorText>{error}</ErrorText>
      {data && children(data, reload)}
    </div>
  );
}

export function MinistryOverviewPage() {
  const { t } = useI18n();
  return (
    <MinistryFrame path="/ministry/overview" title="National shelter overview">
      {(data) => (
        <>
          <div className="stat-grid">
            <Stat value={data.shelter_count} label="Shelters" />
            <Stat value={data.occupancy.toLocaleString()} label="Residents" />
            <Stat value={data.critical_residents} label="Critical residents" />
            <Stat value={data.open_shortages} label="Shortages" tone={data.open_shortages ? "rose" : ""} />
            <Stat value={data.open_complaints} label="Open complaints" />
            <Stat value={data.outbreak_count} label="Outbreak reports" />
          </div>
          <section className="card stack">
            <h3>{t("Where help is needed first")}</h3>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>{t("Shelter")}</th><th>{t("Region")}</th><th>{t("Priority")}</th><th>{t("Shortages")}</th><th>{t("Critical")}</th><th>{t("Occupancy")}</th></tr></thead>
                <tbody>
                  {data.ranked.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.name}</strong></td>
                      <td>{row.region}</td>
                      <td>{row.priority.score}</td>
                      <td>{row.priority.shortages}</td>
                      <td>{row.priority.critical_residents}</td>
                      <td>{row.percent}%{row.overcrowded ? ` · ${t("Overcrowded")}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <Forecast rows={data.forecast} />
          <VerificationQueue />
        </>
      )}
    </MinistryFrame>
  );
}

function Forecast({ rows }) {
  const { t } = useI18n();
  return (
    <section className="card stack">
      <h3>{t("Demand forecast")}</h3>
      {rows.length === 0 && <Empty>{t("Not enough history yet.")}</Empty>}
      {rows.map((row) => (
        <div className="row" key={row.region}>
          <div><strong>{row.region}</strong><div className="small muted">{row.history.map((h) => `${h.month}: ${h.shortages}`).join(" · ")}</div></div>
          <div className="stack" style={{ alignItems: "flex-end" }}>
            <strong>{row.estimate_shortages}</strong>
            <Pill value={row.direction === "rising" ? "high" : row.direction === "falling" ? "resolved" : "neutral"}>{t(row.direction)}</Pill>
          </div>
        </div>
      ))}
    </section>
  );
}

function VerificationQueue() {
  const { t } = useI18n();
  const { data, reload } = useData("/verification-queue");
  const action = useAction(reload);
  const users = data?.users || [];
  return (
    <section className="card stack">
      <h3>{t("Verification queue")}</h3>
      <ErrorText>{action.error}</ErrorText>
      {data && users.length === 0 && <Empty>{t("No accounts waiting.")}</Empty>}
      {users.map((u) => (
        <div className="row" key={u.id}>
          <div><strong>{u.full_name}</strong><div className="small muted">{[u.role, u.specialty, u.license_number, u.license_body].filter(Boolean).join(" · ")}</div></div>
          <div className="inline">
            <StatusPill value={u.verification_status} />
            <Button type="button" soft disabled={action.busy} onClick={() => action.run(`/users/${u.id}/verification`, "PATCH", { status: "approved" })}>Approve</Button>
          </div>
        </div>
      ))}
    </section>
  );
}

function RegisterShelter({ reload }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [form, set, reset] = useForm({ name: "", region: "", kind: "school", address: "", capacity: "", occupancy: "", accessible: false, accessible_spaces: "", has_backup_power: false, electricity_hours: "" });
  const action = useAction(reload);
  if (!open) return <Button type="button" soft onClick={() => setOpen(true)}>Register a shelter</Button>;
  return (
    <form className="card stack" onSubmit={async (e) => { e.preventDefault(); if (await action.run("/shelters", "POST", form)) { reset(); setOpen(false); } }}>
      <h3>{t("Register a shelter")}</h3>
      <div className="grid-2">
        <Field label="Shelter name"><input value={form.name} onChange={set("name")} required /></Field>
        <Field label="Region">
          <select value={form.region} onChange={set("region")} required>
            <option value="">—</option>
            {REGION_LIST.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Type"><Select value={form.kind} onChange={set("kind")} options={[{ value: "school", label: "School" }, { value: "center", label: "Community center" }, { value: "other", label: "Other" }]} /></Field>
        <Field label="Town or address"><input value={form.address} onChange={set("address")} /></Field>
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
      <ErrorText>{action.error}</ErrorText>
      <div className="action-row">
        <Button type="button" ghost onClick={() => setOpen(false)}>Cancel</Button>
        <Button type="submit" disabled={action.busy}>Register</Button>
      </div>
    </form>
  );
}

export function MinistrySheltersPage() {
  const { t } = useI18n();
  return (
    <MinistryFrame path="/ministry/shelters" title="Shelters" sub="Every registered shelter, ordered by need.">
      {(data, reload) => (
        <>
        <RegisterShelter reload={reload} />
        {data.shelters.length === 0 && <Empty>{t("No shelters registered yet.")}</Empty>}
        <section className="card">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{t("Shelter")}</th><th>{t("Capacity")}</th><th>{t("Accessible spaces")}</th><th>{t("Backup power")}</th><th>{t("Shortages")}</th><th>{t("Trend")}</th></tr></thead>
              <tbody>
                {data.shelters.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong><div className="small muted">{s.region}</div></td>
                    <td>{s.occupancy}/{s.capacity} ({s.percent}%)</td>
                    <td>{s.accessible ? s.accessible_spaces ?? "✓" : "—"}</td>
                    <td>{s.has_backup_power ? `${s.electricity_hours}h` : "—"}</td>
                    <td className="small">{s.inventory.filter((i) => i.status === "shortage").map((i) => i.item_name).join(", ") || "—"}</td>
                    <td>{t(s.history.trend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        </>
      )}
    </MinistryFrame>
  );
}

export function MinistryComplaintsPage() {
  const { t } = useI18n();
  const shelters = useData("/shelters");
  const names = Object.fromEntries((shelters.data?.shelters || []).map((s) => [s.id, s.name]));
  return (
    <MinistryFrame path="/ministry/complaints" title="Complaints">
      {(data, reload) => (
        <>
          <ComplaintBoard rows={data.complaints.map((c) => ({ ...c, shelter_name: names[c.shelter_id] }))} reload={reload} t={t} canAdd={false} />
          <section className="card stack">
            <h3>{t("Recurring problems")}</h3>
            {data.patterns.filter((p) => p.count > 1 || p.reopened).map((p) => (
              <div className="row" key={`${p.shelter_id}-${p.category}`}>
                <div><strong>{t(p.category)}</strong><div className="small muted">{p.shelter_name} · {p.region}</div></div>
                <span>{p.count}×</span>
              </div>
            ))}
          </section>
          <section className="card stack">
            <h3>{t("By region")}</h3>
            {data.regions.map((r) => (
              <div className="row" key={r.region}>
                <div><strong>{r.region}</strong><div className="small muted">{r.categories.map((c) => `${t(c.category)} ${c.count}`).join(" · ")}</div></div>

              </div>
            ))}
          </section>
        </>
      )}
    </MinistryFrame>
  );
}

export function MinistryNgosPage() {
  const { t } = useI18n();
  const shelters = useData("/shelters");
  return (
    <MinistryFrame path="/ministry/ngos" title="NGOs" sub="Connect NGO offers with shelters that need them.">
      {(data, reload) => <NgoConnect rows={data.requests} shelters={shelters.data?.shelters || []} reload={reload} t={t} />}
    </MinistryFrame>
  );
}

function NgoConnect({ rows, shelters, reload, t }) {
  const action = useAction(reload);
  return (
    <section className="card">
      <ErrorText>{action.error}</ErrorText>
      {rows.length === 0 && <Empty>{t("No NGO requests yet.")}</Empty>}
      {rows.map((item) => (
        <div className="row" key={item.id}>
          <div><strong>{item.organization}</strong><div className="small">{item.description}</div><div className="small muted">{item.shelter_name ? `→ ${item.shelter_name}` : t("Not connected yet")}</div></div>
          <div className="stack" style={{ alignItems: "flex-end" }}>
            <select aria-label={t("Connect to shelter")} disabled={item.status === "rejected"} value={item.shelter_id || ""} onChange={(e) => action.run(`/ngo/requests/${item.id}`, "PATCH", { shelter_id: Number(e.target.value) })}>
              <option value="">{t("Connect to shelter")}</option>
              {shelters.map((s) => <option key={s.id} value={s.id}>{s.name}{s.shortage_names.length ? ` (${s.shortage_names.length} ${t("short")})` : ""}</option>)}
            </select>
            <StatusSelect value={item.status} options={["submitted", "connected", "accepted", "delivered", "completed", "rejected"]} onChange={(status) => action.run(`/ngo/requests/${item.id}`, "PATCH", { status })} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function MinistryDonationsPage() {
  const { t } = useI18n();
  return (
    <MinistryFrame path="/ministry/donations" title="Donations" sub="Every gift and where it is going.">
      {(data) => (
        <>
          <div className="stat-grid">
            <Stat value={data.donations.length} label="Gifts" />
            <Stat value={money(data.donations.filter((d) => d.kind === "money").reduce((s, d) => s + (d.amount || 0), 0))} label="Money pledged" />
            <Stat value={data.distribution.filter((r) => r.underserved).length} label="Underserved shelters" tone="rose" />
          </div>
          <section className="card stack">
            <h3>{t("Distribution gaps")}</h3>
            <p className="small muted">{t("Calculated live from each shelter's current shortages and the gifts recorded for it.")}</p>
            {data.distribution.filter((r) => r.gaps.length || r.pledged_only?.length).length === 0 && <Empty>{t("Every reported shortage has a gift.")}</Empty>}
            {data.distribution.filter((r) => r.gaps.length || r.pledged_only?.length).map((r) => (
              <div className="row" key={r.shelter_id}>
                <div>
                  <strong>{r.shelter_name}</strong>
                  <div className="small muted">{r.region} · {r.donation_count} {t("gifts")} · {money(r.money)} {t("received")}</div>
                  <div className="small">{t("Still short, no gift yet")}: {r.gaps.join(", ")}</div>
                  {r.pledged_only?.length > 0 && <div className="small muted">{t("Promised but not received yet")}: {r.pledged_only.join(", ")}</div>}
                </div>
                {r.underserved && <Pill value="high">{t("Underserved")}</Pill>}
              </div>
            ))}
          </section>
          <section className="card">
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>{t("Donor")}</th><th>{t("Gift")}</th><th>{t("Recipient")}</th><th>{t("Status")}</th></tr></thead>
                <tbody>
                  {data.donations.map((d) => (
                    <tr key={d.id}>
                      <td>{d.donor_name}</td>
                      <td>{d.kind === "money" ? money(d.amount, d.currency) : d.item_description}</td>
                      <td>{d.shelter_name || d.cause_label || "—"}<div className="small muted">{d.region}</div></td>
                      <td><StatusPill value={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </MinistryFrame>
  );
}

const RISK_KEYS = [["elderly", "Elderly"], ["children", "Children"], ["pregnant", "Pregnant"], ["disability", "Disability"], ["device_dependent", "Device-dependent"]];

export function MinistryReportsPage() {
  const { t } = useI18n();
  return (
    <MinistryFrame path="/ministry/reports" title="Reports">
      {(data, reload) => (
        <>
          <section className="card stack">
            <h3>{t("High-risk counts")}</h3>
            <Note>{t("Counts only. Individual health passports stay with the patient.")}</Note>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>{t("Region")}</th>{RISK_KEYS.map(([k, l]) => <th key={k}>{t(l)}</th>)}</tr></thead>
                <tbody>{data.high_risk.regions.map((r) => <tr key={r.label}><td><strong>{r.label}</strong></td>{RISK_KEYS.map(([k]) => <td key={k}>{r[k]}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </section>
          <OutbreakReview rows={data.outbreaks} reload={reload} />
          <Forecast rows={data.forecast} />
          <section className="card stack">
            <h3>{t("Shelter reporting history")}</h3>
            {data.history.map((row) => (
              <details key={row.shelter.id}>
                <summary><strong>{row.shelter.name}</strong> · {t(row.trend)}</summary>
                <HistoryTable history={row.history} />
              </details>
            ))}
          </section>
        </>
      )}
    </MinistryFrame>
  );
}

function OutbreakReview({ rows, reload }) {
  const { t } = useI18n();
  const action = useAction(reload);
  return (
    <section className="card stack">
      <h3>{t("Outbreak reports")}</h3>
      <Note>{t("This flags a cluster for public health staff. It does not declare an outbreak.")}</Note>
      <ErrorText>{action.error}</ErrorText>
      {rows.length === 0 && <Empty>{t("No reports.")}</Empty>}
      {rows.map((item) => (
        <div className="row" key={item.id}>
          <div><strong>{item.suspected_illness}</strong> · {item.case_count} {t("cases")}<div className="small muted">{item.shelter_name} · {item.region} · {formatWhen(item.created_at)}</div></div>
          <StatusSelect value={item.status} options={["reported", "under_review", "investigating"]} onChange={(status) => action.run(`/outbreaks/${item.id}`, "PATCH", { status })} />
        </div>
      ))}
    </section>
  );
}

const MINISTRY = ["ministry"];

// [path, page, roles allowed] — added to the app by src/roles.js
export const ROUTES = [
  ["/ministry", MinistryOverviewPage, MINISTRY],
  ["/ministry/shelters", MinistrySheltersPage, MINISTRY],
  ["/ministry/complaints", MinistryComplaintsPage, MINISTRY],
  ["/ministry/ngos", MinistryNgosPage, MINISTRY],
  ["/ministry/donations", MinistryDonationsPage, MINISTRY],
  ["/ministry/reports", MinistryReportsPage, MINISTRY],
  ["/ministry/notices", MinistryNoticesPage, MINISTRY],
];
