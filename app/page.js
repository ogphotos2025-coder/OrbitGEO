'use client';
import { useState, useEffect, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

// ============================================================ 
// UTILITIES
// ============================================================ 
function getScoreColor(score) {
  if (score >= 70) return "#059669"; // var(--green)
  if (score >= 40) return "#d97706"; // var(--amber)
  return "#dc2626"; // var(--red)
}

function getScoreLabel(score) {
  if (score >= 75) return "STRONG AUTHORITY";
  if (score >= 50) return "EMERGING";
  if (score >= 25) return "WEAK";
  return "INVISIBLE";
}

function AnimatedNumber({ value, suffix = "" }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = parseInt(value);
    if (isNaN(end)) return;
    const duration = 1200;
    const step = Math.ceil(end / (duration / 16));
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(start);
    }, 16);
    return () => clearInterval(timer);
  }, [value]);
  return <>{display}{suffix}</>;
}

// ============================================================ 
// COMPONENTS
// ============================================================ 
function ScoreRing({ score }) {
  const radius = 42;
  const circ = 2 * Math.PI * radius;
  const color = getScoreColor(score);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setTimeout(() => setProgress(score), 300);
  }, [score]);

  const offset = circ - (progress / 100) * circ;

  return (
    <div className="geo-score-badge" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div className="geo-score-ring" style={{ position: 'relative', width: '100px', height: '100px' }}>
        <svg width="100" height="100" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="6" />
          <circle
            cx="50" cy="50" r={radius} fill="none"
            stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: '24px', fontWeight: 800, color }}>{score}</span>
          <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--slate-400)', textTransform: 'uppercase' }}>GEO</span>
        </div>
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: 'white',
        padding: '12px 16px',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        boxShadow: 'var(--shadow-md)'
      }}>
        <p style={{ fontSize: '12px', fontWeight: 700, color: 'var(--slate-900)', marginBottom: '4px' }}>{label}</p>
        <p style={{ fontSize: '14px', color: payload[0].color, fontWeight: 800 }}>
          Visibility: {payload[0].value}%
        </p>
      </div>
    );
  }
  return null;
};

// ============================================================ 
// MAIN APP logic
// ============================================================ 
export default function OrbitGEO() {
  const [form, setForm] = useState({ url: "", brand: "", industry: "", competitor: "", city: "", turboMode: false });
  const [stage, setStage] = useState("input"); // input | loading | results
  const [loadStep, setLoadStep] = useState(0);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const LOAD_STEPS = [
    "Analyzing Domain Authority...",
    "Querying LLM Data Clusters...",
    "Verifying Citation Linkage...",
    "Evaluating Semantic Sentiment...",
    "Calculating GEO Score..."
  ];

  const handleSubmit = async () => {
    if (!form.url || !form.brand || !form.industry) {
      setError("Required: URL, Brand Name, and Industry.");
      return;
    }
    setError("");
    setStage("loading");
    setLoadStep(0);

    const stepAnimation = async () => {
      for (let i = 0; i < LOAD_STEPS.length; i++) {
        await new Promise(r => setTimeout(r, 1000));
        setLoadStep(i + 1);
      }
    };
    stepAnimation();

    let targetUrl = form.url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
      setForm(p => ({ ...p, url: targetUrl }));
    }

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, url: targetUrl }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Audit failed.");
      }

      const data = await response.json();
      setResults(data);
      setStage("results");
    } catch (e) {
      setError(e.message);
      setStage("input");
    }
  };

  const handleDownloadPdf = async () => {
    const input = document.getElementById('geo-results-container');
    if (!input) return;

    // Capture the entire element
    const canvas = await html2canvas(input, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff"
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const contentWidth = pdfWidth - (margin * 2);
    const contentHeight = (canvas.height * contentWidth) / canvas.width;

    let heightLeft = contentHeight;
    let position = margin;

    // Add first page
    pdf.addImage(imgData, 'PNG', margin, position, contentWidth, contentHeight);
    heightLeft -= (pdfHeight - (margin * 2));

    // add subsequent pages
    while (heightLeft > 0) {
      position = heightLeft - contentHeight + margin;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, position, contentWidth, contentHeight);
      heightLeft -= pdfHeight;
    }

    pdf.save(`OrbitGEO-Audit-${form.brand}.pdf`);
  };

  const copyJsonLd = () => {
    if (!results?.jsonLd) return;
    const text = typeof results.jsonLd === 'string' ? results.jsonLd : JSON.stringify(results.jsonLd, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ---- RENDER LOGIC ----

  if (stage === "loading") {
    return (
      <div className="geo-root">
        <div className="geo-container">
          <div className="geo-loading">
            <div className="geo-orbit">
              <div className="geo-orbit-ring" />
            </div>
            <div className="geo-loading-label">{LOAD_STEPS[loadStep] || "Processing..."}</div>
            <p style={{ color: 'var(--slate-400)', fontSize: '14px' }}>Orbit Engine is analyzing global AI datasets</p>
          </div>
        </div>
      </div>
    );
  }

  if (results && stage === "results") {
    const r = results;
    const mentionCount = r.promptResults?.filter(p => p.mentioned).length || 0;

    return (
      <div className="geo-root">
        <div className="geo-container">
          <header className="geo-header">
            <div className="geo-logo">
              <div className="geo-logo-icon">O</div>
              <span className="geo-logo-name">ORBIT <span>GEO</span></span>
            </div>
            <span className="geo-badge">AUDIT COMPLETE</span>
          </header>

          <div id="geo-results-container" style={{ padding: '48px 0' }}>
            {/* EXEC HEADER */}
            <div className="geo-results-header">
              <div className="geo-brand-info">
                <span className="geo-badge">Executive Summary</span>
                <h2 style={{ marginTop: '16px' }}>{form.brand} Performance</h2>
                <p style={{ color: 'var(--slate-400)', fontSize: '14px', marginBottom: '20px' }}>
                  Target: {form.url} · Industry: {form.industry}
                </p>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <span className={`geo-pill ${r.geoScore >= 50 ? 'positive' : 'negative'}`}>
                    {getScoreLabel(r.geoScore)}
                  </span>
                  {r.schemaFound ? (
                    <span className="geo-pill positive">SCHEMA DETECTED</span>
                  ) : (
                    <span className="geo-pill negative">SCHEMA MISSING</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <ScoreRing score={r.geoScore} />
                <button className="geo-reset-btn" onClick={() => { setResults(null); setStage("input"); }}>
                  New Audit
                </button>
              </div>
            </div>

            {/* METRICS */}
            <p className="geo-section-title">Core Visibility Metrics</p>
            <div className="geo-metrics-grid">
              <div className="geo-metric-card cyan">
                <div className="geo-metric-label">AI Share of Voice</div>
                <div className="geo-metric-value"><AnimatedNumber value={r.visibilityPct} suffix="%" /></div>
                <div className="geo-metric-sub">Mentioned in {mentionCount}/5 prompts</div>
              </div>
              <div className="geo-metric-card amber">
                <div className="geo-metric-label">Citation Health</div>
                <div className="geo-metric-value"><AnimatedNumber value={r.citationHealth} suffix="%" /></div>
                <div className="geo-metric-sub">Direct domain linkage score</div>
              </div>
              <div className="geo-metric-card green">
                <div className="geo-metric-label">Semantic Sentiment</div>
                <div className="geo-metric-value"><AnimatedNumber value={r.sentimentScore} suffix="%" /></div>
                <div className="geo-metric-sub">AI perceived reputation</div>
              </div>
            </div>

            {/* COMPARISON CHART */}
            <p className="geo-section-title">Competitive Landscape Analysis</p>
            <div className="geo-panel">
              <div className="geo-panel-header">
                <span className="geo-panel-title">Visibility Benchmarking — {form.industry}</span>
              </div>
              <div className="geo-panel-body" style={{ height: '350px', padding: '32px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.brandVsCompetitor} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: 'var(--slate-400)', fontSize: 12, fontWeight: 600 }}
                      dy={10}
                    />
                    <YAxis
                      hide={true}
                      domain={[0, 100]}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="visibility" radius={[8, 8, 0, 0]} barSize={60}>
                      {r.brandVsCompetitor?.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="geo-panel-footer" style={{ borderTop: '1px solid var(--border)', padding: '20px 32px' }}>
                <p style={{ color: 'var(--slate-500)', fontSize: '13px', lineHeight: 1.6 }}>
                  <strong>Strategic View:</strong> {r.competitorInsight}
                </p>
              </div>
            </div>

            {/* PROMPTS */}
            <p className="geo-section-title">Prompt Attribution Analysis</p>
            <div className="geo-prompts-list">
              {r.promptResults?.map((p, i) => (
                <div key={i} className={`geo-prompt-item ${p.mentioned ? 'mentioned' : 'not-mentioned'}`}>
                  <div className="geo-prompt-meta">
                    <span className="geo-prompt-type">{p.type} Audit</span>
                    <span className={`geo-mention-label ${p.mentioned ? 'ok' : 'bad'}`}>
                      {p.mentioned ? "✓ ATTRIBUTED" : "✗ NOT ATTRIBUTED"}
                    </span>
                  </div>
                  <p className="geo-prompt-text">AI Query: "{p.prompt}"</p>
                  <p className="geo-prompt-finding">{p.finding}</p>
                </div>
              ))}
            </div>

            {/* STRATEGIC ROADMAP */}
            <p className="geo-section-title">Strategic GEO Roadmap</p>
            <div className="geo-metrics-grid" style={{ gap: '24px' }}>
              <div className="geo-metric-card" style={{ borderLeft: '4px solid var(--primary)', background: 'white' }}>
                <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>Technical Priority</p>
                <p style={{ fontSize: '15px', color: 'var(--slate-900)', fontWeight: 600, lineHeight: 1.4 }}>{r.topFix}</p>
              </div>
              <div className="geo-metric-card" style={{ borderLeft: '4px solid var(--cyan)', background: 'white' }}>
                <p style={{ fontSize: '11px', fontWeight: 800, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '12px' }}>Content Strategy</p>
                <p style={{ fontSize: '15px', color: 'var(--slate-900)', fontWeight: 600, lineHeight: 1.4 }}>{r.contentFix}</p>
              </div>
            </div>

            <div className="geo-panel" style={{ marginTop: '32px' }}>
              <div className="geo-panel-header">
                <span className="geo-panel-title">Prioritized Quick Wins</span>
              </div>
              <div className="geo-panel-body" style={{ padding: '0' }}>
                {r.quickWins?.map((win, i) => (
                  <div key={i} style={{
                    padding: '20px 32px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '20px',
                    borderBottom: i === r.quickWins.length - 1 ? 'none' : '1px solid var(--border)'
                  }}>
                    <span style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: 'rgba(37, 99, 235, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '12px',
                      fontWeight: 800,
                      color: 'var(--primary)'
                    }}>{i + 1}</span>
                    <p style={{ fontSize: '14px', color: 'var(--slate-700)', fontWeight: 500 }}>{win}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* SENTIMENT + SCHEMA */}
            <div className="geo-metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginTop: '32px' }}>
              <div className="geo-panel" style={{ marginBottom: 0 }}>
                <div className="geo-panel-header">
                  <span className="geo-panel-title">Semantic Keyword Mapping</span>
                </div>
                <div className="geo-panel-body">
                  <div className="geo-sentiment-grid">
                    {r.sentimentWords?.map((sw, i) => (
                      <span key={i} className={`geo-pill ${sw.type}`}>{sw.word}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="geo-panel" style={{ marginBottom: 0 }}>
                <div className="geo-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="geo-panel-title">Technical Schema Export</span>
                  <button
                    onClick={copyJsonLd}
                    style={{
                      background: 'none', border: 'none', color: 'var(--primary)',
                      fontSize: '11px', fontWeight: 800, cursor: 'pointer',
                      textTransform: 'uppercase', letterSpacing: '0.05em'
                    }}>
                    {copied ? "COPIED ✅" : "COPY JSON-LD"}
                  </button>
                </div>
                <div className="geo-panel-body" style={{ padding: '0' }}>
                  <pre style={{
                    margin: 0, padding: '24px', background: '#f8fafc',
                    fontSize: '12px', color: 'var(--slate-600)',
                    overflowX: 'auto', fontFamily: 'var(--font-mono)'
                  }}>
                    {typeof r.jsonLd === 'string' ? r.jsonLd : JSON.stringify(r.jsonLd, null, 2)}
                  </pre>
                </div>
              </div>
            </div>

            {/* ACTION FOOTER */}
            <div style={{ marginTop: '64px', padding: '48px', background: 'var(--slate-900)', borderRadius: '24px', textAlign: 'center', color: 'white' }}>
              <h3 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '16px', fontFamily: 'var(--font-orbitron)' }}>Ready to Optimize?</h3>
              <p style={{ color: 'var(--slate-400)', maxWidth: '500px', margin: '0 auto 32px' }}>
                Download the full PDF report or schedule a strategy session to improve your LLM visibility.
              </p>
              <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                <button className="geo-cta" style={{ width: 'auto', padding: '14px 40px' }} onClick={handleDownloadPdf}>
                  Download Audit report
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="geo-root">
      <div className="geo-container">
        <header className="geo-header">
          <div className="geo-logo">
            <div className="geo-logo-icon">O</div>
            <span className="geo-logo-name">ORBIT <span>GEO</span></span>
          </div>
          <span className="geo-badge">Enterprise Edition</span>
        </header>

        <section className="geo-hero">
          <div className="geo-hero-eyebrow">Digital Authority Intelligence</div>
          <h1>Is Your Brand <em>Invisible</em> to AI?</h1>
          <p className="geo-hero-sub">
            OrbitGEO is the industry standard for Generative Engine Optimization.
            Identify visibility gaps in LLMs and control your digital authority.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              className="geo-cta"
              style={{ width: 'auto', padding: '16px 48px' }}
              onClick={() => document.getElementById('audit-form').scrollIntoView({ behavior: 'smooth' })}
            >
              Start Enterprise Audit
            </button>
          </div>
        </section>

        <section className="geo-trusted">
          <p className="geo-trusted-label">Used by growth teams at leading companies</p>
          <div className="geo-trusted-logos">
            <span className="geo-logo-item">VELOCITY</span>
            <span className="geo-logo-item">SILVERLINE</span>
            <span className="geo-logo-item">NEXUS</span>
            <span className="geo-logo-item">EQUINOX</span>
            <span className="geo-logo-item">APEX</span>
          </div>
        </section>

        <div id="audit-form" className="geo-input-card">
          <div className="geo-field-group">
            <div className="geo-field geo-field-full">
              <label>Brand Name</label>
              <input
                type="text"
                placeholder="e.g. Stripe"
                value={form.brand}
                onChange={e => setForm({ ...form, brand: e.target.value })}
              />
            </div>
            <div className="geo-field geo-field-full">
              <label>Website URL</label>
              <input
                type="text"
                placeholder="stripe.com"
                value={form.url}
                onChange={e => setForm({ ...form, url: e.target.value })}
              />
            </div>
            <div className="geo-field">
              <label>Industry</label>
              <input
                type="text"
                placeholder="Fintech"
                value={form.industry}
                onChange={e => setForm({ ...form, industry: e.target.value })}
              />
            </div>
            <div className="geo-field">
              <label>Main Competitor</label>
              <input
                type="text"
                placeholder="Adyen"
                value={form.competitor}
                onChange={e => setForm({ ...form, competitor: e.target.value })}
              />
            </div>

            <div className="geo-toggle-group">
              <div className="geo-toggle-label">
                <div className="geo-toggle-title">
                  Turbo Mode <span className="geo-turbo-tag">Fast & Free</span>
                </div>
                <p className="geo-toggle-desc">Instant score via raw data. Skips AI narrative to avoid quota limits.</p>
              </div>
              <label className="geo-switch">
                <input
                  type="checkbox"
                  checked={form.turboMode}
                  onChange={e => setForm({ ...form, turboMode: e.target.checked })}
                />
                <span className="geo-slider"></span>
              </label>
            </div>
          </div>
          {error && <p style={{ color: 'var(--red)', fontSize: '14px', marginBottom: '16px', fontWeight: 600 }}>{error}</p>}
          <button className="geo-cta" onClick={handleSubmit}>Initialize Audit</button>
        </div>

        <footer style={{ padding: '64px 0', textAlign: 'center', borderTop: '1px solid var(--border)', marginTop: '80px' }}>
          <p style={{ color: 'var(--slate-400)', fontSize: '13px' }}>© 2026 OrbitGEO Intelligence. All rights reserved.</p>
        </footer>
      </div>

      <div className="geo-status-bar">
        <span>SYSTEM STATUS: OPERATIONAL</span>
      </div>
    </div>
  );
}