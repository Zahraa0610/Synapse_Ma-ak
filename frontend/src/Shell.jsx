import { NavLink, Navigate, useNavigate } from "react-router-dom";
import { homeFor } from "./api";
import { ROLE_PATHS } from "./roles";
import { useAuth, useI18n } from "./context";
import { LangToggle, Mark } from "./ui";

const PHONE_NAV = {
  caregiver: [
    ["/home", "Home"],
    ["/passport", "Health passport"],
    ["/care", "Care"],
    ["/requests", "Requests"],
    ["/me", "Profile"],
  ],
  volunteer: [
    ["/volunteer", "Tasks"],
    ["/volunteer/notices", "Notices"],
    ["/volunteer/complaints", "Complaints"],
    ["/volunteer/support", "Support"],
    ["/me", "Profile"],
  ],
  donor: [
    ["/donor", "Needs"],
    ["/donor/gifts", "My donations"],
    ["/me", "Profile"],
  ],
};

// Links to pages that are not in src/roles/ yet are hidden.
const available = (links) => links.filter(([to]) => to === "/me" || ROLE_PATHS.has(to));

const DESK_NAV = {
  shelter_coordinator: [
    ["/shelter", "Overview"],
    ["/shelter/residents", "Residents"],
    ["/shelter/supplies", "Supplies and shortages"],
    ["/shelter/exchange", "Exchange"],
    ["/shelter/donations", "Donations"],
    ["/shelter/volunteers", "Volunteers"],
    ["/shelter/complaints", "Complaints"],
    ["/shelter/reports", "Reports"],
    ["/lookup", "Find passport"],
  ],
  doctor: [["/doctor", "Patients"], ["/lookup", "Find passport"], ["/doctor/notices", "Health events"]],
  nurse: [["/doctor", "Patients"], ["/lookup", "Find passport"], ["/doctor/notices", "Health events"]],
  psychologist: [["/doctor", "Patients"], ["/lookup", "Find passport"]],
  ministry: [
    ["/ministry", "Overview"],
    ["/ministry/shelters", "Shelters"],
    ["/ministry/complaints", "Complaints"],
    ["/ministry/ngos", "NGOs"],
    ["/ministry/donations", "Donations"],
    ["/ministry/reports", "Reports"],
    ["/ministry/notices", "Health events"],
  ],
  ngo: [["/ngo", "Coordination"]],
};

export default function Shell({ children }) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const phone = PHONE_NAV[user.role] && available(PHONE_NAV[user.role]);
  if (phone) {
    return (
      <div className="shell">
        <div className="phone-shell">
          <header className="topbar">
            <div className="inline"><Mark /><strong>Ma'ak</strong></div>
            <LangToggle />
          </header>
          {children}
        </div>
        <nav className="bottom-nav">
          {phone.map(([to, label]) => (
            <NavLink key={to} to={to} end={to.split("/").length <= 2}>
              {t(label)}
            </NavLink>
          ))}
        </nav>
      </div>
    );
  }
  const links = available(DESK_NAV[user.role] || []);
  return (
    <div className="desk">
      <aside className="sidebar">
        <div className="brand-block" style={{ padding: "8px 12px 16px" }}>
          <div className="inline"><Mark /><strong>Ma'ak</strong></div>
          <div className="small" style={{ opacity: 0.8, marginTop: 8 }}>{user.full_name}</div>
        </div>
        {links.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === "/shelter" || to === "/ministry" || to === "/doctor" || to === "/ngo"}>
            {t(label)}
          </NavLink>
        ))}
        <div style={{ marginTop: "auto" }} />
        <button className="linkish" type="button" onClick={() => { logout(); navigate("/login"); }}>{t("Sign out")}</button>
      </aside>
      <main className="desk-main">
        <div className="desk-top">
          <div>
            <div className="muted small">{t(roleLabel(user.role))}</div>
            <h2>{user.full_name}</h2>
          </div>
          <LangToggle />
        </div>
        {children}
      </main>
    </div>
  );
}

export function roleLabel(role) {
  return {
    caregiver: "User / caregiver",
    volunteer: "Volunteer",
    doctor: "Doctor",
    nurse: "Nurse",
    psychologist: "Psychologist",
    shelter_coordinator: "Shelter coordinator",
    donor: "Donor",
    ministry: "Ministry of Public Health",
    ngo: "NGO",
  }[role] || role;
}

export function Guard({ children, roles }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="app-loading">Ma'ak</div>;
  if (!user) return <Navigate to="/login" replace />;
  // A signed-in user opening another role's page goes back to their own home.
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

export function Guest({ children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="app-loading">Ma'ak</div>;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}
