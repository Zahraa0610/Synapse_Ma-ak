import { useI18n } from "./context";
import { toneFor } from "./api";

// The Ma'ak logo (frontend/public/logo.png)
export function Mark({ size = 40 }) {
  return <img className="brand-mark" src="/logo.png" width={size} height={size} alt="Ma'ak" />;
}

export function LangToggle() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-toggle" role="group" aria-label="Language">
      <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")} type="button">EN</button>
      <button className={lang === "ar" ? "active" : ""} onClick={() => setLang("ar")} type="button">عربي</button>
    </div>
  );
}

export function Pill({ value, children }) {
  return <span className={`pill tone-${toneFor(value)}`}>{children || value}</span>;
}

export function Note({ children }) {
  return <p className="quiet-note">{children}</p>;
}

export function ErrorText({ children }) {
  if (!children) return null;
  return <div className="error">{children}</div>;
}

export function Field({ label, children }) {
  const { t } = useI18n();
  return (
    <label className="field">
      <span>{t(label)}</span>
      {children}
    </label>
  );
}

export function TextInput(props) {
  return <input {...props} />;
}

export function Select({ options, ...props }) {
  const { t } = useI18n();
  return (
    <select {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{t(option.label)}</option>
      ))}
    </select>
  );
}

export function Button({ children, soft, ghost, className = "", ...props }) {
  const { t } = useI18n();
  const base = ghost ? "btn-ghost" : soft ? "btn-soft" : "btn";
  return (
    <button className={`${base} ${className}`.trim()} {...props}>
      {typeof children === "string" ? t(children) : children}
    </button>
  );
}

export function Empty({ children }) {
  return <p className="muted small">{children}</p>;
}

export function Bars({ value, max = 100, tone }) {
  const width = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return (
    <div className={`bar ${tone || ""}`} aria-hidden="true">
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export function useT() {
  return useI18n().t;
}
