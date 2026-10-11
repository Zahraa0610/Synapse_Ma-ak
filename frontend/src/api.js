const TOKEN_KEY = "maak_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`/api${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong");
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function fileUrl(path) {
  const response = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!response.ok) throw new Error("Could not open the file");
  return URL.createObjectURL(await response.blob());
}

export function homeFor(role) {
  if (role === "volunteer") return "/volunteer";
  if (role === "donor") return "/donor";
  if (role === "shelter_coordinator") return "/shelter";
  if (role === "doctor" || role === "nurse" || role === "psychologist") return "/doctor";
  if (role === "ministry") return "/ministry";
  if (role === "ngo") return "/ngo";
  return "/home";
}

export function toneFor(status) {
  const value = String(status || "").toLowerCase();
  if (["shortage", "critical", "missed", "high", "declined", "cancelled", "overdue", "missing"].includes(value)) return "rose";
  if (["low", "checking", "documents_received", "requested", "under_review", "submitted", "pledged", "proposed", "open", "in_transit", "being_addressed", "acknowledged", "escalated"].includes(value)) return "amber";
  if (["available", "approved", "completed", "resolved", "accepted", "distributed", "delivered", "non_critical", "administered", "connected", "not_required", "received"].includes(value)) return "green";
  return "neutral";
}

export function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
