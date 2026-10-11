import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api, homeFor } from "./api";
import { useAuth, useI18n } from "./context";
import { Button, ErrorText, Field, LangToggle, Mark, Note, Pill, Select } from "./ui";

const ROLES = [
  ["caregiver", "User / caregiver"],
  ["volunteer", "Volunteer"],
  ["doctor", "Doctor"],
  ["nurse", "Nurse"],
  ["psychologist", "Psychologist"],
  ["shelter_coordinator", "Shelter coordinator"],
  ["donor", "Donor"],
  ["ministry", "Ministry"],
  ["ngo", "NGO"],
];
const CLINICAL = new Set(["doctor", "nurse", "psychologist"]);
const HELPERS = [
  ["general", "General help"],
  ["medical_student", "Medical student"],
  ["nursing_student", "Nursing student"],
  ["companion", "Hospital companion"],
];

export function LandingPage() {
  const { t } = useI18n();
  return (
    <div className="center-page">
      <div className="auth-wrap">
        <div className="spread"><Mark size={88} /><LangToggle /></div>
        <h1 style={{ marginTop: 28 }}>{t("Your health record, wherever you go.")}</h1>
        <p className="muted">Ma'ak keeps a health passport with displaced families, shelters, volunteers, and the Ministry of Public Health.</p>
        <div className="stack" style={{ marginTop: 22 }}>
          <Link to="/register"><Button className="full">Sign up</Button></Link>
          <Link to="/login"><Button ghost className="full">I already have an account</Button></Link>
          <Link to="/emergency" className="text-btn">{t("Scan emergency code")}</Link>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useI18n();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("phone");
  const [phone, setPhone] = useState("+961");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [sending, setSending] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  async function sendCode() {
    setError("");
    setHint("");
    setSending(true);
    try {
      const result = await api("/auth/send-code", { method: "POST", body: JSON.stringify({ phone, purpose: "login" }) });
      setCodeSent(true);
      setHint(result.channel === "console"
        ? t("WhatsApp is not set up on this server yet. The code was printed in the server console.")
        : t("If this number has an account, we sent a code on WhatsApp."));
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const user = mode === "phone"
        ? await login({ phone, code })
        : await login({ email, password });
      navigate(homeFor(user.role));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="center-page">
      <form className="auth-wrap auth-card" onSubmit={submit}>
        <div className="spread"><Mark size={56} /><LangToggle /></div>
        <div>
          <h1>{t("Welcome back")}</h1>
          <p className="muted">{t("Sign in to Ma'ak. Your role is remembered from sign-up.")}</p>
        </div>
        <div className="segment">
          <button type="button" className={mode === "phone" ? "active" : ""} onClick={() => setMode("phone")}>{t("Phone code")}</button>
          <button type="button" className={mode === "email" ? "active" : ""} onClick={() => setMode("email")}>{t("Email + password")}</button>
        </div>
        {mode === "phone" ? (
          <>
            <Field label="Phone number (WhatsApp)"><input type="tel" autoComplete="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setCodeSent(false); }} placeholder="+961 70 123 456" /></Field>
            <Button type="button" soft disabled={sending || phone.replace(/\D/g, "").length < 8} onClick={sendCode}>
              {sending ? "Sending…" : codeSent ? "Send a new code" : "Send code on WhatsApp"}
            </Button>
            {hint && <p className="small muted">{hint}</p>}
            {codeSent && <Field label="6-digit code"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required /></Field>}
          </>
        ) : (
          <>
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Button className="full" type="submit">Sign in</Button>
        <Link to="/register">{t("Create an account")}</Link>
        <Link to="/emergency">{t("Emergency aid works without signing in")}</Link>
      </form>
    </div>
  );
}

export function RegisterPage() {
  const { t } = useI18n();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState("account");
  const [shelters, setShelters] = useState([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    role: "caregiver",
    full_name: "",
    phone: "+961",
    email: "",
    password: "",
    helper_type: "general",
    specialty: "",
    license_number: "",
    license_body: "",
    license_expires: "",
    shelter_id: "",
    id_document_type: "lebanese_id",
    id_document_number: "",
    offers_driving: false,
    car_model: "",
    car_plate: "",
    car_seats: "",
    car_wheelchair: false,
  });
  const [file, setFile] = useState(null);
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const wantsEmail = form.email.trim() !== "";
  const [captured, setCaptured] = useState(false);
  const set = (key) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
  };
  const volunteer = form.role === "volunteer";
  const totalSteps = CLINICAL.has(form.role) || volunteer ? 3 : 2;
  useEffect(() => { ensureShelters(); }, []);

  async function ensureShelters() {
    if (shelters.length) return;
    const data = await api("/shelters/names").catch(() => null);
    if (data) setShelters(data.shelters);
  }

  async function nextAccount(event) {
    event.preventDefault();
    setError("");
    if (!verifiedPhone) return setError(t("Confirm your phone number with the WhatsApp code first."));
    if (!shelters.length) {
      try {
        const data = await api("/shelters/names");
        setShelters(data.shelters || []);
      } catch {
        setShelters([]);
      }
    }
    if (CLINICAL.has(form.role)) setStep("verify");
    else if (form.role === "volunteer") setStep("identity");
    else setStep("review");
  }

  async function finish(event) {
    event.preventDefault();
    setError("");
    try {
      const user = await register({
        ...form,
        shelter_id: form.shelter_id || null,
        phone: verifiedPhone,
        email: form.email.trim() || null,
        password: wantsEmail ? form.password : "",
      });
      if (file) {
        const body = new FormData();
        body.append("file", file);
        const updated = await api("/me/verification-file", { method: "POST", body });
        user.verification_status = updated.user.verification_status;
      }
      navigate(homeFor(user.role));
    } catch (err) {
      setError(err.message);
    }
  }

  if (step === "scan") {
    return (
      <div className="scan-screen">
        <div className="spread">
          <button className="text-btn" style={{ color: "#f4f1ea" }} type="button" onClick={() => setStep("verify")}>{t("Back")}</button>
          <span>{t("Order of Physicians card")}</span>
        </div>
        <div className="viewfinder">
          <div>
            <h2>{t("Order of Physicians card")}</h2>
            <p>{t("Hold the card inside the frame. Ma'ak stores the image for a reviewer. It does not read the card by itself.")}</p>
          </div>
        </div>
        <Field label="Upload a document"><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        <Button type="button" onClick={() => { setCaptured(true); setStep("review"); }}>{t("Card detected — hold still")}</Button>
      </div>
    );
  }

  return (
    <div className="center-page">
      <form className="auth-wrap auth-card" onSubmit={step === "review" ? finish : nextAccount}>
        <div className="spread"><Mark size={56} /><LangToggle /></div>
        {step === "account" && (
          <>
            <div>
              <p className="small muted">{t("Step")} 1 / {totalSteps}</p>
              <h1>{t("Create your account")}</h1>
            </div>
            <div>
              <div className="small">{t("I am signing up as")}</div>
              <div className="role-grid" style={{ marginTop: 8 }}>
                {ROLES.map(([value, label]) => (
                  <button type="button" key={value} className={form.role === value ? "active" : ""} onClick={() => setForm({ ...form, role: value })}>{label}</button>
                ))}
              </div>
            </div>
            <Field label="Full name"><input value={form.full_name} onChange={set("full_name")} required /></Field>
            <PhoneVerify phone={form.phone} onPhone={(value) => setForm((cur) => ({ ...cur, phone: value }))} verified={verifiedPhone} onVerified={setVerifiedPhone} />
            <Field label="Email (optional)"><input type="email" autoComplete="email" value={form.email} onChange={set("email")} /></Field>
            {wantsEmail && (
              <Field label="Password for email sign-in (8+ characters)">
                <input type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set("password")} required />
              </Field>
            )}
            <p className="small muted">{t("You sign in with a WhatsApp code sent to your phone. Adding an email lets you also sign in with email and password.")}</p>
            {form.role === "volunteer" && (
              <Field label="Helper type">
                <Select value={form.helper_type} onChange={set("helper_type")} options={HELPERS.map(([value, label]) => ({ value, label }))} />
              </Field>
            )}
            {(form.role === "shelter_coordinator" || form.role === "caregiver") && (
              <Field label={form.role === "caregiver" ? "Shelter you are staying at" : "Shelter"}>
                <select value={form.shelter_id} onChange={set("shelter_id")} onFocus={ensureShelters}>
                  <option value="">{form.role === "caregiver" ? "Not in a shelter" : "Choose after sign-in"}</option>
                  {shelters.map((shelter) => <option key={shelter.id} value={shelter.id}>{shelter.name}</option>)}
                </select>
              </Field>
            )}
            <Button className="full" type="submit">Continue</Button>
            <Link to="/login">{t("Already have an account? Sign in")}</Link>
          </>
        )}
        {step === "verify" && (
          <>
            <div>
              <p className="small muted">{t("Step")} 2 / 3</p>
              <h1>{t("Verify your license")}</h1>
              <p className="small muted">{t("Only doctors, nurses and psychologists need a license check.")}</p>
            </div>
            <Field label="Specialty"><input value={form.specialty} onChange={set("specialty")} /></Field>
            <Field label="License number"><input value={form.license_number} onChange={set("license_number")} /></Field>
            <Field label="Licensing body"><input value={form.license_body} onChange={set("license_body")} /></Field>
            <Field label="License expires"><input type="date" value={form.license_expires} onChange={set("license_expires")} /></Field>
            <Button type="button" ghost onClick={() => setStep("scan")}>{t("Scan license card")}</Button>
            <div className="action-row">
              <Button type="button" ghost onClick={() => setStep("account")}>{t("Back")}</Button>
              <Button type="button" onClick={() => setStep("review")}>{t("Submit for review")}</Button>
            </div>
          </>
        )}
        {step === "identity" && (
          <>
            <div>
              <p className="small muted">{t("Step")} 2 / 3</p>
              <h1>{t("Your ID and car")}</h1>
              <p className="small muted">{t("Shelters need to know who is helping. No license is needed.")}</p>
            </div>
            <fieldset className="check-group">
              <legend>{t("ID document")}</legend>
              <label className="check"><input type="radio" name="id_type" checked={form.id_document_type === "lebanese_id"} onChange={() => setForm({ ...form, id_document_type: "lebanese_id" })} /> {t("Lebanese ID")}</label>
              <label className="check"><input type="radio" name="id_type" checked={form.id_document_type === "passport"} onChange={() => setForm({ ...form, id_document_type: "passport" })} /> {t("Passport")}</label>
            </fieldset>
            <Field label={form.id_document_type === "passport" ? "Passport number" : "Lebanese ID number"}>
              <input value={form.id_document_number} onChange={set("id_document_number")} required />
            </Field>
            <Field label="Photo of the ID (optional)"><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
            <div className="check-group">
              <label className="check"><input type="checkbox" checked={form.offers_driving} onChange={set("offers_driving")} /> {t("I can drive people or supplies")}</label>
            </div>
            {form.offers_driving && (
              <div className="card stack">
                <h3>{t("Car details")}</h3>
                <div className="grid-2">
                  <Field label="Car make and model"><input value={form.car_model} onChange={set("car_model")} placeholder={t("e.g. Kia Picanto, white")} required /></Field>
                  <Field label="Plate number"><input value={form.car_plate} onChange={set("car_plate")} placeholder="B 123456" required /></Field>
                  <Field label="Free seats"><input type="number" min="1" max="8" value={form.car_seats} onChange={set("car_seats")} /></Field>
                </div>
                <div className="check-group">
                  <label className="check"><input type="checkbox" checked={form.car_wheelchair} onChange={set("car_wheelchair")} /> {t("Fits a wheelchair")}</label>
                </div>
              </div>
            )}
            <div className="action-row">
              <Button type="button" ghost onClick={() => setStep("account")}>{t("Back")}</Button>
              <Button type="button" onClick={(e) => { const f = e.currentTarget.form; if (f.reportValidity()) setStep("review"); }}>{t("Continue")}</Button>
            </div>
          </>
        )}
        {step === "review" && (
          <>
            <div>
              <p className="small muted">{t("Step")} {totalSteps} / {totalSteps}</p>
              <h1>{t("Check your details")}</h1>
            </div>
            <div className="card stack">
              <strong>{form.full_name}</strong>
              <span className="muted">{ROLES.find(([value]) => value === form.role)?.[1]}</span>
              {form.license_number && <span>{t("License number")}: {form.license_number}</span>}
              {form.license_body && <span>{form.license_body}</span>}
              {volunteer && <span>{t(form.id_document_type === "passport" ? "Passport" : "Lebanese ID")}: {form.id_document_number}</span>}
              {volunteer && form.offers_driving && <span>{t("Car")}: {form.car_model} · {form.car_plate}</span>}
              <div className="stack">
                <span><Pill value="approved" /> {t("Account created")}</span>
                {CLINICAL.has(form.role) && <span><Pill value="documents_received" /> {t("Documents received")}</span>}
                {CLINICAL.has(form.role) && <span><Pill value="checking" /> {t("Checking with the licensing body")}</span>}
                {captured && <span className="small muted">Card capture recorded for a human reviewer.</span>}
              </div>
            </div>
            <ErrorText>{error}</ErrorText>
            <div className="action-row">
              <Button type="button" ghost onClick={() => setStep(CLINICAL.has(form.role) ? "verify" : volunteer ? "identity" : "account")}>{t("Back")}</Button>
              <Button type="submit">{t("Confirm and continue")}</Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

// Phone number + "send code on WhatsApp" + code box. Calls onVerified(phone) when confirmed.
function PhoneVerify({ phone, onPhone, verified, onVerified }) {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const isVerified = verified && verified === normalize(phone);

  function normalize(value) {
    const clean = (value || "").replace(/[\s\-().]/g, "");
    return clean.startsWith("00") ? `+${clean.slice(2)}` : clean;
  }

  async function send() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/auth/send-code", { method: "POST", body: JSON.stringify({ phone, purpose: "signup" }) });
      setSent(true);
      setHint(result.channel === "console"
        ? t("WhatsApp is not set up on this server yet. The code was printed in the server console.")
        : t("We sent a 6-digit code on WhatsApp."));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/auth/verify-code", { method: "POST", body: JSON.stringify({ phone, code }) });
      onVerified(result.phone);
      setHint("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Field label="Phone number (WhatsApp)">
        <input type="tel" autoComplete="tel" value={phone} placeholder="+961 70 123 456"
          onChange={(e) => { onPhone(e.target.value); setSent(false); setCode(""); onVerified(""); }} />
      </Field>
      {isVerified ? (
        <div className="banner green small">✓ {t("Phone number confirmed")}</div>
      ) : (
        <>
          <Button type="button" soft disabled={busy || phone.replace(/\D/g, "").length < 8} onClick={send}>
            {busy && !sent ? "Sending…" : sent ? "Send a new code" : "Send code on WhatsApp"}
          </Button>
          {hint && <p className="small muted">{hint}</p>}
          {sent && (
            <div className="inline">
              <input aria-label={t("6-digit code")} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder={t("6-digit code")}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              <Button type="button" disabled={busy || code.length !== 6} onClick={check}>Confirm</Button>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
        </>
      )}
    </div>
  );
}

export function EmergencyPage() {
  const { t } = useI18n();
  const saved = JSON.parse(localStorage.getItem("maak_offline") || "[]");
  return (
    <div className="center-page">
      <div className="auth-wrap stack">
        <div className="spread"><Mark size={56} /><LangToggle /></div>
        <h1>{t("Emergency summary")}</h1>
        <Note>{t("No internet is required for a summary saved on this phone.")}</Note>
        {saved.length === 0 && <p className="muted">Nothing is saved on this phone yet. Sign in and choose “Save on this phone” from a health passport.</p>}
        {saved.map((item) => <SummaryCard key={item.profile_id} summary={item} />)}
        <Link to="/login">{t("Sign in")}</Link>
      </div>
    </div>
  );
}

export function PublicEmergencyPage() {
  const { token } = useParams();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api(`/emergency/${token}`).then((data) => setSummary(data.summary)).catch((err) => setError(err.message));
  }, [token]);
  return (
    <div className="center-page">
      <div className="auth-wrap stack">
        <Mark />
        <h1>Emergency card</h1>
        <ErrorText>{error}</ErrorText>
        {summary && <SummaryCard summary={summary} />}
      </div>
    </div>
  );
}

export function SummaryCard({ summary }) {
  const { t } = useI18n();
  return (
    <div className="qr-card stack">
      <h2>{summary.full_name}</h2>
      <div className="inline" style={{ justifyContent: "center" }}>
        {summary.blood_type && <Pill>{summary.blood_type}</Pill>}
        <Pill value={summary.criticality}>{summary.criticality}</Pill>
      </div>
      <Line label={t("Allergies")} value={(summary.allergies || []).join(", ") || "—"} />
      <Line label={t("Conditions")} value={(summary.conditions || []).join(", ") || "—"} />
      <Line label={t("Medications")} value={(summary.medications || []).join(", ") || "—"} />
      <Line label="Contact" value={[summary.emergency_contact_name, summary.emergency_contact_phone].filter(Boolean).join(" · ") || "—"} />
      {(summary.dependencies || []).map((item, index) => (
        <p key={index} className="small">{item.device_name || item.kind}: {item.supply_level_percent ?? "—"}% · {item.hours_remaining ?? "—"}h</p>
      ))}
      <p className="small muted">{summary.note}</p>
      {summary.token && <QRCodeSVG value={`${window.location.origin}/e/${summary.token}`} size={148} />}
    </div>
  );
}

function Line({ label, value }) {
  return <p><strong>{label}. </strong>{value}</p>;
}

export function saveOffline(summary) {
  const all = JSON.parse(localStorage.getItem("maak_offline") || "[]");
  const next = [summary, ...all.filter((item) => item.profile_id !== summary.profile_id)];
  localStorage.setItem("maak_offline", JSON.stringify(next));
}
