// Donor pages. Picked up automatically from src/roles/ (see src/roles.js).
import { useState } from "react";
import { Link } from "react-router-dom";
import { formatWhen } from "../api";
import { useI18n } from "../context";
import { LIVING_SITUATIONS, money, PageTitle, Stat, StatusPill, useAction, useData, useForm } from "../shared";
import { Button, Empty, ErrorText, Field, Note, Pill } from "../ui";

/* ------------------------------------------------------------------ */
/* Donor                                                               */
/* ------------------------------------------------------------------ */

function GiveForm({ opportunity, onDone }) {
  const { t } = useI18n();
  const [form, set] = useForm({ kind: "money", amount: "", item_description: opportunity.item_description || "" });
  const { run, error, busy } = useAction();
  const [done, setDone] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const result = await run("/donations", "POST", {
      kind: form.kind,
      amount: form.kind === "money" ? form.amount : undefined,
      item_description: form.kind === "physical" ? form.item_description : undefined,
      target_type: opportunity.target_type,
      target_shelter_id: opportunity.target_shelter_id,
      target_profile_id: opportunity.target_profile_id,
      cause_label: opportunity.target_type === "cause" ? opportunity.title : undefined,
      donation_request_id: opportunity.donation_request_id,
      from_recommendation: opportunity.recommended,
    });
    if (result) { setDone(true); onDone?.(); }
  }
  if (done) {
    return (
      <div className="banner green stack">
        <strong>{t("Thank you!")}</strong>
        <span className="small">{t(opportunity.kind === "request" ? "The family will confirm when they receive it." : "The shelter coordinator will confirm when it is received.")}</span>
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="segment">
        <button type="button" className={form.kind === "money" ? "active" : ""} onClick={() => set("kind")({ target: { value: "money" } })}>{t("Money")}</button>
        <button type="button" className={form.kind === "physical" ? "active" : ""} onClick={() => set("kind")({ target: { value: "physical" } })}>{t("Supplies")}</button>
      </div>
      {form.kind === "money"
        ? <Field label="Amount (USD)"><input type="number" min="1" value={form.amount} onChange={set("amount")} required /></Field>
        : <Field label="What will you give?"><input value={form.item_description} onChange={set("item_description")} required /></Field>}
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy}>Give</Button>
    </form>
  );
}

function Opportunity({ item, onDone }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="card stack">
      <div className="spread">
        <span className="eyebrow">{t(item.kind === "case" ? "Medical case" : item.kind === "request" ? "Family outside a shelter" : "Shelter need")}</span>
        {item.verified ? <Pill value="approved">{t("Verified")}</Pill> : <Pill value="neutral">{t("Not verified by a shelter")}</Pill>}
      </div>
      <strong>{t(item.title)}</strong>
      <p className="small">{item.detail}</p>
      <p className="small muted">{[
        item.living_situation ? t(LIVING_SITUATIONS.find(([v]) => v === item.living_situation)?.[1]) : null,
        item.people_count ? `${item.people_count} ${t("people")}` : null,
        item.shelter_name, item.area, item.region,
      ].filter(Boolean).join(" · ")}</p>
      {open ? <GiveForm opportunity={item} onDone={onDone} /> : <Button type="button" onClick={() => setOpen(true)}>Give</Button>}
    </div>
  );
}

export function DonorNeedsPage() {
  const { t } = useI18n();
  const { data, error, reload } = useData("/donor/board");
  const [region, setRegion] = useState("all");
  const items = data?.opportunities || [];
  const regions = [...new Set(items.map((item) => item.region).filter(Boolean))];
  const shown = items.filter((item) => region === "all" || item.region === region);
  return (
    <div className="stack">
      <PageTitle sub="Verified needs reported by shelter coordinators.">Where help is needed</PageTitle>
      <ErrorText>{error}</ErrorText>
      {data?.recommendation && (
        <section className="stack">
          <h3>{t("Suggested if you have no recipient in mind")}</h3>
          <Note>{t("You still choose. Nothing is assigned automatically.")}</Note>
          <Opportunity item={data.recommendation} onDone={reload} />
        </section>
      )}
      {regions.length > 1 && (
        <div className="chip-row" role="group" aria-label={t("Region")}>
          {["all", ...regions].map((value) => (
            <button key={value} type="button" className={`chip ${region === value ? "active" : ""}`} aria-pressed={region === value} onClick={() => setRegion(value)}>{value === "all" ? t("All") : value}</button>
          ))}
        </div>
      )}
      {shown.filter((item) => !item.recommended).map((item) => <Opportunity key={item.key} item={item} onDone={reload} />)}
      {data && items.length === 0 && <Empty>{t("No open needs right now.")}</Empty>}
    </div>
  );
}

export function DonorGiftsPage() {
  const { t } = useI18n();
  const { data, error } = useData("/donor/board");
  const gifts = data?.donations || [];
  const total = gifts.filter((g) => g.kind === "money").reduce((sum, g) => sum + (g.amount || 0), 0);
  return (
    <div className="stack">
      <PageTitle>My donations</PageTitle>
      <ErrorText>{error}</ErrorText>
      <div className="stat-grid">
        <Stat value={gifts.length} label="Donations" />
        <Stat value={money(total)} label="Money given" />
      </div>
      <section className="card">
        {data && gifts.length === 0 && <Empty>{t("You have not donated yet.")} <Link to="/donor">{t("See needs")}</Link></Empty>}
        {gifts.map((gift) => (
          <div className="row" key={gift.id}>
            <div>
              <strong>{gift.kind === "money" ? money(gift.amount, gift.currency) : gift.item_description}</strong>
              <div className="small muted">{[gift.shelter_name || gift.cause_label, formatWhen(gift.created_at)].filter(Boolean).join(" · ")}</div>
            </div>
            <StatusPill value={gift.status} />
          </div>
        ))}
      </section>
    </div>
  );
}

const DONOR = ["donor"];

// [path, page, roles allowed] — added to the app by src/roles.js
export const ROUTES = [
  ["/donor", DonorNeedsPage, DONOR],
  ["/donor/gifts", DonorGiftsPage, DONOR],
];
