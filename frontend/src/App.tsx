import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Courier,
  CourierEvent,
  NEXT_STATUS,
  STATUS_LABEL,
  Status,
  api,
  money,
} from "./lib/api";

type View = "dashboard" | "couriers" | "add" | "delivered" | "track" | "pricing" | "reports";

const FLOW: Status[] = ["booked", "in_transit", "out_for_delivery", "delivered"];

function useTheme() {
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.getAttribute("data-theme") || "dark"
  );
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("swc-theme", next);
    } catch {
      /* ignore */
    }
  };
  return { theme, toggle };
}

function Spark({ values, width = 120, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <svg className="spark" width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="spark" width={width} height={height} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`pill st-${status}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const EMPTY_FORM = { customer_name: "", phone: "", parcel_type: "Documents", weight_kg: "2", source: "", destination: "" };

export default function App() {
  const { theme, toggle } = useTheme();
  const [view, setView] = useState<View>("dashboard");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("swc-nav") === "collapsed";
    } catch {
      return false;
    }
  });
  const [navOpen, setNavOpen] = useState(false);
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErr, setFormErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pricePreview, setPricePreview] = useState<number | null>(null);
  const [trackInput, setTrackInput] = useState("");
  const [tracked, setTracked] = useState<Courier | null>(null);
  const [trackErr, setTrackErr] = useState("");
  const [scanEvents, setScanEvents] = useState<CourierEvent[]>([]);
  const [copied, setCopied] = useState(false);
  const [printCourier, setPrintCourier] = useState<Courier | null>(null);
  const [calcWeight, setCalcWeight] = useState("3");
  const [calcOut, setCalcOut] = useState<string>("");

  const refresh = useCallback(async (opts: { status?: string; q?: string } = {}) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.list(opts);
      setCouriers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load couriers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem("swc-nav", collapsed ? "collapsed" : "open");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Live price preview for the add-form weight.
  useEffect(() => {
    const w = Number(form.weight_kg);
    if (!w || w <= 0 || w > 500) {
      setPricePreview(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const p = await api.previewCharge(w);
        setPricePreview(p.total_usd);
      } catch {
        setPricePreview(null);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [form.weight_kg]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return couriers.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (!needle) return true;
      return [c.tracking_id, c.customer_name, c.source, c.destination, String(c.id)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [couriers, q, statusFilter]);

  const stats: { booked: number; in_transit: number; out_for_delivery: number; delivered: number; cancelled: number; total: number; revenue: number } = useMemo(() => {
    const by = { booked: 0, in_transit: 0, out_for_delivery: 0, delivered: 0, cancelled: 0 };
    let revenue = 0;
    for (const c of couriers) {
      by[c.status] = (by[c.status] ?? 0) + 1;
      revenue += c.charge_usd ?? 0;
    }
    return { ...by, total: couriers.length, revenue };
  }, [couriers]);

  const go = (v: View, keepQuery = false) => {
    setView(v);
    setNavOpen(false);
    if (!keepQuery) setQ(""); // stale top-bar text must never blank out a fresh view
    if (v === "couriers") {
      setStatusFilter("");
      refresh();
    }
    if (v === "delivered") refresh({ status: "delivered" });
    if (v === "dashboard" || v === "reports") refresh();
  };

  const advance = async (c: Courier) => {
    const next = NEXT_STATUS[c.status];
    if (!next) return;
    try {
      await api.setStatus(c.id, next);
      await refresh(statusFilter ? { status: statusFilter } : {});
    } catch (e) {
      alert(e instanceof Error ? e.message : "Status update failed");
    }
  };

  const remove = async (c: Courier) => {
    if (!window.confirm(`Delete courier ${c.tracking_id} (${c.customer_name})?`)) return;
    try {
      await api.remove(c.id);
      await refresh(statusFilter ? { status: statusFilter } : {});
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (form.customer_name.trim().length < 2) errs.customer_name = "Enter the customer name.";
    if (form.phone.trim().length < 7) errs.phone = "Enter a valid phone number.";
    if (form.parcel_type.trim().length < 2) errs.parcel_type = "Enter the parcel type.";
    const w = Number(form.weight_kg);
    if (!w || w <= 0 || w > 500) errs.weight_kg = "Weight must be 0–500 kg.";
    if (form.source.trim().length < 2) errs.source = "Enter the origin city.";
    if (form.destination.trim().length < 2) errs.destination = "Enter the destination city.";
    setFormErr(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    try {
      const created = await api.create({
        customer_name: form.customer_name.trim(),
        phone: form.phone.trim(),
        parcel_type: form.parcel_type.trim(),
        weight_kg: w,
        source: form.source.trim(),
        destination: form.destination.trim(),
      });
      setForm(EMPTY_FORM);
      await refresh();
      setTrackInput(String(created.id));
      setTracked(created);
      setView("track");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const lookup = async (value: string) => {
    setTrackErr("");
    setTracked(null);
    setScanEvents([]);
    const raw = value.trim().toUpperCase();
    if (!raw) {
      setTrackErr("Enter a courier ID or tracking code.");
      return;
    }
    try {
      let hit: Courier;
      if (/^\d+$/.test(raw)) {
        hit = await api.get(Number(raw));
      } else {
        try {
          hit = await api.byTracking(raw); // exact tracking-code endpoint
        } catch {
          const all = await api.list({ q: raw }); // fuzzy fallback
          const fuzzy = all.find((c) => c.tracking_id.toUpperCase() === raw) ?? all[0] ?? null;
          if (!fuzzy) throw new Error(`No courier found for “${value.trim()}”.`);
          hit = fuzzy;
        }
      }
      setTracked(hit);
      try {
        setScanEvents(await api.events(hit.id));
      } catch {
        setScanEvents([]);
      }
    } catch (err) {
      setTrackErr(err instanceof Error ? err.message : "Lookup failed");
    }
  };

  const doTrack = async (e?: React.FormEvent) => {
    e?.preventDefault();
    await lookup(trackInput);
  };

  // Shareable tracking links: ?track=<id> deep-links straight to a shipment
  // (market standard — branded tracking pages customers can bookmark).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("track");
    if (t) {
      setTrackInput(t);
      setView("track");
      lookup(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyTrackLink = async (c: Courier) => {
    const url = `${window.location.origin}${window.location.pathname}?track=${c.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const printLabel = (c: Courier) => {
    setPrintCourier(c);
    setTimeout(() => window.print(), 60);
  };

  // Logistics pillar: tracking answerable in <5s from the persistent top bar.
  const topSearch = async () => {
    const v = q.trim();
    if (/^\d+$/.test(v) || /^SWC-/i.test(v)) {
      setTrackInput(v);
      setView("track");
      setNavOpen(false);
      await lookup(v);
    } else {
      go("couriers", true); // keep the query so the table filters by it
    }
  };

  const doCalc = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setCalcOut("");
    const w = Number(calcWeight);
    if (!w || w <= 0 || w > 500) {
      setCalcOut("Enter a weight between 0 and 500 kg.");
      return;
    }
    try {
      const p = await api.previewCharge(w);
      setCalcOut(`${money(p.total_usd)}  (base ${money(p.base_fee_usd)} + ${w} kg × ${money(p.rate_per_kg_usd)})`);
    } catch (err) {
      setCalcOut(err instanceof Error ? err.message : "Pricing failed");
    }
  };

  const exportCsv = () => {
    const rows = [["id", "tracking_id", "customer", "phone", "parcel", "weight_kg", "from", "to", "status", "charge_usd"]];
    for (const c of filtered) {
      rows.push([c.id, c.tracking_id, c.customer_name, c.phone, c.parcel_type, c.weight_kg, c.source, c.destination, c.status, c.charge_usd].map(String));
    }
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "couriers.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const weights = couriers.slice(0, 12).map((c) => c.weight_kg);
  const charges = couriers.slice(0, 12).map((c) => c.charge_usd);

  return (
    <div className={`shell${collapsed ? " collapsed" : ""}${navOpen ? " nav-open" : ""}`}>
      {navOpen && <button className="drawer-veil" aria-label="Close menu" onClick={() => setNavOpen(false)} />}

      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><IcoRoute /></div>
          <div>
            <div className="brand-name">SwiftCourier</div>
            <div className="brand-sub">COURIER OPS · USA</div>
          </div>
        </div>
        <div className="nav-section">Operate</div>
        <NavBtn active={view === "dashboard"} onClick={() => go("dashboard")} label="Dashboard" icon={<IcoGrid />} />
        <NavBtn active={view === "couriers"} onClick={() => go("couriers")} label="All couriers" icon={<IcoBox />} />
        <NavBtn active={view === "add"} onClick={() => go("add")} label="Add courier" icon={<IcoPlus />} />
        <NavBtn active={view === "delivered"} onClick={() => go("delivered")} label="Delivered" icon={<IcoCheck />} />
        <NavBtn active={view === "track"} onClick={() => go("track")} label="Track & status" icon={<IcoPin />} />
        <NavBtn active={view === "pricing"} onClick={() => go("pricing")} label="Pricing" icon={<IcoTag />} />
        <NavBtn active={view === "reports"} onClick={() => go("reports")} label="Revenue" icon={<IcoChart />} />
        <div style={{ flex: 1 }} />
        <NavBtn active={false} onClick={() => setCollapsed((v) => !v)} label={collapsed ? "Expand" : "Collapse"} icon={<IcoFold />} />
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn only-mobile" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
          <button className="icon-btn" onClick={() => setCollapsed((v) => !v)} aria-label="Toggle sidebar" title="Toggle sidebar">☰</button>
          <div className="search" role="search">
            <span aria-hidden="true">⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Track ID / code, or search customer, city…"
              aria-label="Track or search couriers"
              onKeyDown={(e) => {
                if (e.key === "Enter") topSearch();
              }}
            />
            <kbd>Enter ↵</kbd>
          </div>
          <span className="pill st-delivered mono" title="Backend docs & health">
            <span className="live-dot" aria-hidden="true" />
            <a href="/docs" style={{ color: "inherit", textDecoration: "none" }}>API</a>
          </span>
          <button className="icon-btn" onClick={toggle} aria-label="Toggle theme" title={`Theme: ${theme}`}>
            {theme === "dark" ? "☾" : "☀"}
          </button>
        </header>

        <main className="content">
          <div className="view-enter" key={view}>
          {error && <p className="notice error" role="alert">Backend unreachable: {error}. Start it with docker compose up, then retry.</p>}

          {view === "dashboard" && (
            <div className="stack">
              <div>
                <h1 className="page-h">Operations overview</h1>
                <p className="page-sub">Five numbers that run the business. Everything else is one click away.</p>
              </div>
              {loading ? (
                <div className="grid-kpi">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="card"><div className="skel" style={{ minHeight: 96 }} /></div>)}</div>
              ) : (
                <div className="grid-kpi">
                  <div className="card lift"><div className="kpi-top"><span className="kpi-tile"><IcoBox /></span></div><div className="kpi-label">Total shipments</div><div className="kpi-value num">{stats.total}</div><div className="kpi-delta">across all statuses</div><Spark values={weights} /></div>
                  <div className="card lift"><div className="kpi-top"><span className="kpi-tile"><IcoPin /></span></div><div className="kpi-label">In motion</div><div className="kpi-value num">{stats.in_transit + stats.out_for_delivery}</div><div className="kpi-delta">in transit + out for delivery</div><Spark values={charges} /></div>
                  <div className="card lift"><div className="kpi-top"><span className="kpi-tile"><IcoCheck /></span></div><div className="kpi-label">Delivered</div><div className="kpi-value num">{stats.delivered}</div><div className="kpi-delta">completed shipments</div></div>
                  <div className="card lift"><div className="kpi-top"><span className="kpi-tile money"><IcoChart /></span></div><div className="kpi-label">Revenue</div><div className="kpi-value num">{money(stats.revenue)}</div><div className="kpi-delta">all-time gross</div></div>
                  <div className="card lift"><div className="kpi-top"><span className="kpi-tile"><IcoTag /></span></div><div className="kpi-label">Avg. ticket</div><div className="kpi-value num">{money(stats.total ? stats.revenue / stats.total : 0)}</div><div className="kpi-delta">per shipment</div></div>
                </div>
              )}
              <div className="row-2">
                <div className="card">
                  <h2 className="panel-title">Live activity</h2>
                  <p className="panel-sub">Most recent bookings and status changes.</p>
                  {loading ? <div className="skel" style={{ minHeight: 120 }} /> : couriers.length === 0 ? (
                    <EmptyState
                      title="No shipments yet"
                      body="Book your first courier and it will appear here in real time."
                      action="Book a courier"
                      onAction={() => go("add")}
                    />
                  ) : (
                    <ul className="feed">
                      {couriers.slice(0, 6).map((c) => (
                        <li key={c.id}>
                          <span><strong className="mono">{c.tracking_id}</strong> · <span className="cust">{c.customer_name}</span> <span className="muted">· {c.source} → {c.destination}</span></span>
                          <StatusPill status={c.status} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="card">
                  <h2 className="panel-title">Status mix</h2>
                  <p className="panel-sub">Share of shipments by stage.</p>
                  <DistBar stats={stats} />
                  <div style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 13 }}>
                    {FLOW.concat(["cancelled" as Status]).map((s) => (
                      <div key={s} style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>{STATUS_LABEL[s as Status]}</span>
                        <strong className="num">{(stats as unknown as Record<string, number>)[s] ?? 0}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {(view === "couriers" || view === "delivered") && (
            <div className="stack">
              <div>
                <h1 className="page-h">{view === "delivered" ? "Delivered couriers" : "All couriers"}</h1>
                <p className="page-sub">{filtered.length} shown · advance a shipment or delete it from the row.</p>
              </div>
              <div className="chips" role="group" aria-label="Status filter">
                {["", "booked", "in_transit", "out_for_delivery", "delivered", "cancelled"].map((s) => (
                  <button key={s || "all"} className={`chip${statusFilter === s ? " active" : ""}`} aria-pressed={statusFilter === s}
                    onClick={() => { setStatusFilter(s); refresh(s ? { status: s } : {}); }}>
                    {s ? STATUS_LABEL[s as Status] : "All"}
                  </button>
                ))}
              </div>
              <div className="toolbar">
                <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
                <button className="btn" onClick={() => go("add")}>+ Add courier</button>
              </div>
              {loading ? <div className="card"><div className="skel" /><div className="skel" style={{ marginTop: 8 }} /></div>
                : filtered.length === 0 ? (
                  <div className="card">
                    <EmptyState
                      title="Nothing matches"
                      body="No courier records found. Adjust the search or status filter — or book a new shipment."
                      action="Book a courier"
                      onAction={() => go("add")}
                    />
                  </div>
                ) : (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>ID</th><th>Customer</th><th>Parcel</th><th className="num">Weight</th><th>Route</th><th>Status</th><th className="num">Charge</th><th>Actions</th></tr></thead>
                        <tbody>
                          {filtered.map((c) => (
                            <tr key={c.id}>
                              <td className="mono">{c.tracking_id}<br /><span className="muted">#{c.id}</span></td>
                              <td><div className="truncate"><span className="cust">{c.customer_name}</span><br /><span className="muted mono">{c.phone}</span></div></td>
                              <td className="truncate">{c.parcel_type}</td>
                              <td className="num">{c.weight_kg.toFixed(1)} kg</td>
                              <td className="truncate">{c.source} → {c.destination}</td>
                              <td><StatusPill status={c.status} /></td>
                              <td className="num">{money(c.charge_usd)}</td>
                              <td>
                                <div className="toolbar">
                                  {NEXT_STATUS[c.status] && <button className="btn ghost" onClick={() => advance(c)}>→ {STATUS_LABEL[NEXT_STATUS[c.status] as Status]}</button>}
                                  <button className="btn danger" onClick={() => remove(c)}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
            </div>
          )}

          {view === "add" && (
            <div className="card" style={{ maxWidth: 760 }}>
              <h1 className="page-h">Add courier</h1>
              <p className="panel-sub">Charge is calculated server-side at booking. {pricePreview !== null && <>Estimated: <strong className="num">{money(pricePreview)}</strong></>}</p>
              <form onSubmit={submit}>
                <div className="form-grid">
                  <div className="field"><label htmlFor="f-name">Customer name</label><input id="f-name" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="e.g. Alex Morgan" />{formErr.customer_name && <span className="err">{formErr.customer_name}</span>}</div>
                  <div className="field"><label htmlFor="f-phone">Phone</label><input id="f-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. +1 555 010 2030" />{formErr.phone && <span className="err">{formErr.phone}</span>}</div>
                  <div className="field"><label htmlFor="f-parcel">Parcel type</label><input id="f-parcel" value={form.parcel_type} onChange={(e) => setForm({ ...form, parcel_type: e.target.value })} placeholder="Documents / Electronics / …" />{formErr.parcel_type && <span className="err">{formErr.parcel_type}</span>}</div>
                  <div className="field"><label htmlFor="f-weight">Weight (kg)</label><input id="f-weight" inputMode="decimal" value={form.weight_kg} onChange={(e) => setForm({ ...form, weight_kg: e.target.value })} placeholder="2.0" />{formErr.weight_kg && <span className="err">{formErr.weight_kg}</span>}</div>
                  <div className="field"><label htmlFor="f-src">Source</label><input id="f-src" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. Austin" />{formErr.source && <span className="err">{formErr.source}</span>}</div>
                  <div className="field"><label htmlFor="f-dst">Destination</label><input id="f-dst" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} placeholder="e.g. Denver" />{formErr.destination && <span className="err">{formErr.destination}</span>}</div>
                </div>
                <div className="toolbar" style={{ marginTop: 14 }}>
                  <button className="btn" type="submit" disabled={saving}>{saving ? "Booking…" : "Book courier"}</button>
                  <button className="btn ghost" type="button" onClick={() => setForm(EMPTY_FORM)}>Clear</button>
                </div>
              </form>
            </div>
          )}

          {view === "track" && (
            <div className="stack">
              <div className="card" style={{ maxWidth: 760 }}>
                <h1 className="page-h">Track & update status</h1>
                <p className="page-sub">Numeric ID or tracking code (e.g. SWC-9F3K2A). Forward-only flow, enforced server-side.</p>
                <form onSubmit={doTrack} className="toolbar">
                  <input value={trackInput} onChange={(e) => setTrackInput(e.target.value)} placeholder="ID or tracking code" aria-label="Tracking lookup"
                    style={{ minHeight: 46, flex: 1, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-sunken)", color: "var(--text)", padding: "0 14px", font: "inherit" }} />
                  <button className="btn" type="submit">Track</button>
                </form>
                {trackErr && <p className="notice error" role="alert" style={{ marginTop: 12 }}>{trackErr}</p>}
              </div>
              {tracked && (
                <div className="row-2">
                  <div className="card">
                    <h2 className="panel-title mono">{tracked.tracking_id} · #{tracked.id}</h2>
                    <p className="panel-sub">{tracked.customer_name} · {tracked.source} → {tracked.destination} · <strong className="num">{money(tracked.charge_usd)}</strong>{tracked.eta_label && <> · <strong>{tracked.eta_label}</strong></>}</p>
                    <div className="toolbar" style={{ marginBottom: 12 }}>
                      <button className="btn ghost sm" onClick={() => copyTrackLink(tracked)}>{copied ? "Link copied ✓" : "Copy tracking link"}</button>
                      <button className="btn ghost sm" onClick={() => printLabel(tracked)}>Print label</button>
                    </div>
                    <Stepper courier={tracked} />
                    <ol className="timeline">
                      {FLOW.map((s, i) => {
                        const cur = FLOW.indexOf(tracked.status as Status);
                        const cls = tracked.status === "cancelled" ? "" : i < cur ? "done" : i === cur ? "current" : "";
                        return <li key={s} className={cls}><div><div className="tl-title">{STATUS_LABEL[s]}</div><div className="tl-sub">{i === 0 ? `Booked · ${tracked.parcel_type} · ${tracked.weight_kg} kg` : s === "delivered" ? "Signed & completed" : "Carrier scan"}</div></div></li>;
                      })}
                    </ol>
                    {tracked.status === "cancelled" && <p className="notice error">This shipment was cancelled.</p>}
                    {scanEvents.length > 0 && (
                      <>
                        <h3 className="panel-title" style={{ marginTop: 18 }}>Scan history</h3>
                        <p className="panel-sub">Immutable event log — disputes become lookups.</p>
                        <ul className="scan">
                          {scanEvents.map((ev) => (
                            <li key={ev.id}>
                              <span className="scan-dot" aria-hidden="true" />
                              <div>
                                <div className="scan-msg">{ev.message}</div>
                                <div className="scan-time num">{new Date(ev.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                              </div>
                              <StatusPill status={ev.to_status} />
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                  <div className="card">
                    <h2 className="panel-title">Update delivery status</h2>
                    <p className="panel-sub">Current: <StatusPill status={tracked.status} /></p>
                    <div className="toolbar">
                      {NEXT_STATUS[tracked.status] ? (
                        <button className="btn" onClick={async () => { await advance(tracked); const u = await api.get(tracked.id); setTracked(u); try { setScanEvents(await api.events(u.id)); } catch { /* keep old */ } }}>Advance → {STATUS_LABEL[NEXT_STATUS[tracked.status] as Status]}</button>
                      ) : <span className="muted">No further transitions.</span>}
                    </div>
                    <div className="chips">
                      {(["booked", "in_transit", "out_for_delivery", "delivered", "cancelled"] as Status[]).map((s) => (
                        <button key={s} className="chip" disabled={s === tracked.status} aria-pressed={s === tracked.status}
                          onClick={async () => { try { const u = await api.setStatus(tracked.id, s); setTracked(u); try { setScanEvents(await api.events(u.id)); } catch { /* keep old */ } refresh(); } catch (err) { alert(err instanceof Error ? err.message : "Update failed"); } }}>
                          {STATUS_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {view === "pricing" && (
            <div className="card" style={{ maxWidth: 640 }}>
              <h1 className="page-h">Pricing calculator</h1>
              <p className="panel-sub">Transparent USA pricing: $6.99 base + $4.50 per kg. Same formula the server uses at booking.</p>
              <form onSubmit={doCalc} className="toolbar">
                <input value={calcWeight} onChange={(e) => setCalcWeight(e.target.value)} inputMode="decimal" aria-label="Weight in kg" placeholder="Weight (kg)"
                  style={{ minHeight: 44, width: 160, borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-sunken)", color: "var(--text)", padding: "0 12px", font: "inherit" }} />
                <input type="range" min={0.5} max={50} step={0.5} value={Number(calcWeight) || 0} onChange={(e) => setCalcWeight(e.target.value)} aria-label="Weight slider" style={{ flex: 1, accentColor: "var(--accent)" }} />
                <button className="btn" type="submit">Calculate</button>
              </form>
              {calcOut && <p className="notice num" style={{ marginTop: 12 }}>{calcOut}</p>}
            </div>
          )}

          {view === "reports" && (
            <div className="stack">
              <div className="card">
                <h1 className="page-h">Revenue report</h1>
                <p className="panel-sub">Gross across all shipments · {stats.total} shipments · {stats.delivered} delivered.</p>
                <div className="kpi-value num">{money(stats.revenue)}</div>
                <div style={{ marginTop: 14 }}>
                  <h2 className="panel-title">Last 14 days</h2>
                  <RevenueBars couriers={couriers} />
                </div>
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <button className="btn ghost" onClick={exportCsv}>Export CSV</button>
                  <button className="btn ghost" onClick={() => refresh()}>Refresh</button>
                </div>
              </div>
              <div className="card">
                <h2 className="panel-title">Per-shipment charges</h2>
                <ul className="feed">
                  {couriers.slice(0, 10).map((c) => (
                    <li key={c.id}><span><strong className="mono">{c.tracking_id}</strong> <span className="muted">· {c.weight_kg.toFixed(1)} kg</span></span><strong className="num">{money(c.charge_usd)}</strong></li>
                  ))}
                </ul>
                {couriers.length === 0 && <p className="muted">No data yet.</p>}
              </div>
            </div>
          )}
          </div>
        </main>
      </div>
      {printCourier && (
        <div className="ship-label" aria-hidden="true">
          <div className="ship-head">
            <strong>SWIFTCOURIER</strong>
            <span>GROUND PARCEL · {printCourier.tracking_id}</span>
          </div>
          <div className="ship-route">
            <div><small>FROM</small><strong>{printCourier.source}</strong></div>
            <div className="ship-arrow">→</div>
            <div><small>TO</small><strong>{printCourier.destination}</strong></div>
          </div>
          <div className="ship-meta">
            <span>{printCourier.customer_name} · {printCourier.phone}</span>
            <span>{printCourier.parcel_type} · {printCourier.weight_kg.toFixed(1)} kg</span>
            <span className="mono">{printCourier.tracking_id} · #{printCourier.id}</span>
          </div>
          <div className="ship-bar">{printCourier.tracking_id.split("").join(" ")}</div>
        </div>
      )}
    </div>
  );
}

function NavBtn({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: React.ReactNode }) {
  return (
    <button className={`nav-btn${active ? " active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}>
      {icon}
      <span className="nav-label">{label}</span>
    </button>
  );
}

function EmptyState({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div className="empty">
      <svg width="72" height="52" viewBox="0 0 72 52" fill="none" aria-hidden="true">
        <rect x="6" y="14" width="46" height="30" rx="6" stroke="var(--border-strong)" strokeWidth="2" />
        <path d="M52 22l12-7v22l-12-7" stroke="var(--border-strong)" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="20" cy="44" r="4" stroke="var(--accent-2)" strokeWidth="2" />
        <circle cx="44" cy="44" r="4" stroke="var(--accent-2)" strokeWidth="2" />
        <path d="M14 26h18" stroke="var(--border-strong)" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 4" />
      </svg>
      <h3>{title}</h3>
      <p>{body}</p>
      <button className="btn" onClick={onAction}>{action}</button>
    </div>
  );
}

function Stepper({ courier }: { courier: Courier }) {
  if (courier.status === "cancelled") return null;
  const cur = FLOW.indexOf(courier.status);
  const subs = ["Label created", "Linehaul scan", "Courier is nearby", "Signed & completed"];
  return (
    <ol className="stepper" aria-label="Delivery progress">
      {FLOW.map((s, i) => (
        <li key={s} className={i < cur ? "done" : i === cur ? "current" : "todo"} aria-current={i === cur ? "step" : undefined}>
          <div className="step-title">{STATUS_LABEL[s]}</div>
          <div className="step-sub">{subs[i]}</div>
        </li>
      ))}
    </ol>
  );
}

function RevenueBars({ couriers }: { couriers: Courier[] }) {
  const days: Array<{ key: string; label: string; total: number }> = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, label: d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" }), total: 0 });
  }
  const byDay = new Map(days.map((d) => [d.key, d]));
  for (const c of couriers) {
    const key = new Date(c.created_at).toISOString().slice(0, 10);
    const bucket = byDay.get(key);
    if (bucket) bucket.total = Math.round((bucket.total + (c.charge_usd ?? 0)) * 100) / 100;
  }
  const max = Math.max(...days.map((d) => d.total), 1);
  return (
    <div className="bars" role="img" aria-label="Revenue by day, last 14 days">
      {days.map((d) => (
        <div key={d.key} className="bar-col" title={`${d.key}: ${money(d.total)}`}>
          <div className="bar-track">
            <div className="bar-fill" style={{ height: `${Math.max(3, (d.total / max) * 100)}%`, opacity: d.total ? 1 : 0.35 }} />
          </div>
          <span className="bar-label">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

function DistBar({ stats }: { stats: Record<string, number> }) {  const total = stats.total || 1;
  const segs: Array<[string, string]> = [
    ["booked", "var(--info)"],
    ["in_transit", "var(--warning)"],
    ["out_for_delivery", "var(--accent)"],
    ["delivered", "var(--success)"],
    ["cancelled", "var(--danger)"],
  ];
  return (
    <div className="distbar" role="img" aria-label="Status distribution">
      {segs.map(([k, color]) => (
        <div key={k} style={{ width: `${(((stats[k] ?? 0) / total) * 100).toFixed(1)}%`, background: color }} title={`${k}: ${stats[k] ?? 0}`} />
      ))}
    </div>
  );
}

const S = { width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" } as const;
function IcoGrid() { return (<svg {...S} viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>); }
function IcoBox() { return (<svg {...S} viewBox="0 0 24 24"><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>); }
function IcoPlus() { return (<svg {...S} viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>); }
function IcoCheck() { return (<svg {...S} viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>); }
function IcoPin() { return (<svg {...S} viewBox="0 0 24 24"><path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>); }
function IcoTag() { return (<svg {...S} viewBox="0 0 24 24"><path d="M3 12V4h8l9 9-8 8z" /><circle cx="8" cy="9" r="1.4" /></svg>); }
function IcoChart() { return (<svg {...S} viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></svg>); }
function IcoFold() { return (<svg {...S} viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h16" /></svg>); }
function IcoRoute() { return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="19" r="2.4" /><circle cx="19" cy="5" r="2.4" /><path d="M7.5 19H15a3 3 0 000-6H9a3 3 0 010-6h7.5" strokeDasharray="1 3" /></svg>); }
