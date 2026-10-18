"use client";
import { useEffect, useRef, useState } from "react";
import { renderApp } from "../lib/appUI";

export default function App() {
  const [status, setStatus] = useState("checking");
  const [me, setMe] = useState(null);
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef(null);
  const state = useRef({ currentView: null, data: {}, activeChannelId: null, chatPollInterval: null, activeDocId: null, calMode: null, calMonthAnchor: null, staffList: null, crmSearch: "" });

  function applyBoot(boot) {
    state.current.data = boot.data;
    const qv = new URLSearchParams(window.location.search).get("view");
    state.current.currentView = qv && boot.allowedViews.includes(qv) ? qv : boot.homeView;
    setMe(boot);
    setStatus("loggedIn");
  }

  async function loadSession() {
    setStatus("checking");
    setLoginError("");
    try {
      const meRes = await fetch("/api/me");
      if (meRes.status === 401) {
        setStatus("loggedOut");
        return;
      }
      if (!meRes.ok) {
        setStatus("loadError");
        return;
      }
      const bootRes = await fetch("/api/bootstrap");
      if (bootRes.status === 401) {
        setStatus("loggedOut");
        return;
      }
      if (!bootRes.ok) {
        setStatus("loadError");
        return;
      }
      applyBoot(await bootRes.json());
    } catch {
      setStatus("loadError");
    }
  }

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    if (status === "loggedIn" && me && rootRef.current) {
      renderApp(rootRef.current, me, state, () => setMe({ ...me }));
    }
  }, [status, me]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");
    setSubmitting(true);
    const form = e.target;
    const email = form.email.value.trim();
    const password = form.password.value;
    try {
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
      await loadSession();
    } catch {
      setLoginError("Could not reach TCM Staff. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "checking") {
    return (
      <div className="login-wrap">
        <div className="boot-status" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true"></div>
          Loading TCM Staff…
        </div>
      </div>
    );
  }

  if (status === "loadError") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand"><span className="dot"></span> TCM Staff</div>
          <div className="login-error" role="alert">Couldn’t load the workspace. Check your connection and try again.</div>
          <button className="btn" type="button" onClick={loadSession}>Try again</button>
        </div>
      </div>
    );
  }

  if (status === "loggedOut") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand"><span className="dot"></span> TCM Staff</div>
          <p className="login-sub">Collectibles Marketplace · Lakewood</p>
          {loginError && <div className="login-error" role="alert">{loginError}</div>}
          <form onSubmit={handleLogin}>
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input id="login-email" type="email" name="email" autoComplete="username" placeholder="you@tcmstaff.com" required aria-invalid={loginError ? "true" : "false"} />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input id="login-password" type="password" name="password" autoComplete="current-password" required aria-invalid={loginError ? "true" : "false"} />
            </div>
            <button className="btn" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>
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
