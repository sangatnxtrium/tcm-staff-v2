"use client";
import{useEffect,useRef,useState}from"react";import{renderApp}from"../lib/appUI";
export default function App() {
  const [status, setStatus] = useState("checking");
  const [me, setMe] = useState(null);
  const [loginError, setLoginError] = useState("");
  const rootRef = useRef(null);
  const state = useRef({ currentView: null, data: {}, activeChannelId: null, chatPollInterval: null, activeDocId: null, calMode: null, calMonthAnchor: null, staffList: null, crmSearch: "" });
  useEffect(() => {
    fetch("/api/me")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(() => fetch("/api/bootstrap").then((r) => r.json()))
    .then((boot) => {
      state.current.data = boot.data;
      const qv = new URLSearchParams(window.location.search).get("view");
      state.current.currentView = qv && boot.allowedViews.includes(qv) ? qv : boot.homeView;
      setMe(boot);
      setStatus("loggedIn");
    })
    .catch(() => setStatus("loggedOut"));
  }, []);
  useEffect(() => {
    if (status === "loggedIn" && me && rootRef.current) {
      renderApp(rootRef.current, me, state, () => setMe({ ...me }));
    }
  }, [status, me]);
  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");
    const form = e.target;
    const email = form.email.value.trim();
    const password = form.password.value;
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setLoginError(body.error || "Sign-in failed");
      return;
    }
    setStatus("checking");
    const boot = await fetch("/api/bootstrap").then((r) => r.json());
    state.current.data = boot.data;
    const qv = new URLSearchParams(window.location.search).get("view");
    state.current.currentView = qv && boot.allowedViews.includes(qv) ? qv : boot.homeView;
    setMe(boot);
    setStatus("loggedIn");
  }
  if (status === "checking") {
    return <div className="login-wrap"><div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div></div>;
}
if (status === "loggedOut") {
  return (
    <div className="login-wrap">
    <div className="login-card">
    <div className="brand"><span className="dot"></span> TCM Staff</div>
  {loginError && <div className="login-error">{loginError}</div>}
  <form onSubmit={handleLogin}>
    <div className="field">
    <label>Email</label>
  <input type="email" name="email" placeholder="you@tcmstaff.com" required />
    </div>
  <div className="field">
    <label>Password</label>
  <input type="password" name="password" required />
    </div>
  <button className="btn" type="submit">Sign in</button>
    </form>
  <div className="login-hint">
    Staff accounts are provisioned by the Operations Manager. If you don't have credentials
    yet or forgot your password, ask your Operations Manager to reset it.
    </div>
    </div>
    </div>
  );
}
return <div id="app-root" ref={rootRef}></div>;
}
