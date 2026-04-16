import React, { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Activity, TrendingUp, Calendar, BarChart3, Brain, Scale, Target, ArrowRight, Check } from 'lucide-react';

interface LandingProps {
  onNavigate: (page: string) => void;
}

function useCounter(target: number, duration = 1800, start = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, start]);
  return count;
}

function StatCard({ value, suffix, label }: { value: number; suffix: string; label: string; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const count = useCounter(value, 1600, visible);
  useEffect(() => {
    const observer = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVisible(true); }, { threshold: 0.3 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="stat-card">
      <div className="stat-number">{count}{suffix}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Landing({ onNavigate }: LandingProps) {
  const [scrolled, setScrolled] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setActiveStep(s => (s + 1) % 3), 3000);
    return () => clearInterval(interval);
  }, []);

  const features = [
    { icon: <Brain className="h-6 w-6" />, title: 'Bayesian Intelligence', description: 'Continuously learns from your weight and intake data to refine calorie targets with mathematical precision.', tag: 'Core Algorithm' },
    { icon: <Target className="h-6 w-6" />, title: 'Smart Meal Plans', description: 'Database-grounded plans built around your goals, allergies, and food preferences — regenerate in seconds.', tag: 'Meal Planning' },
    { icon: <BarChart3 className="h-6 w-6" />, title: 'Macro Tracking', description: 'Log food, monitor protein, carbs and fat against daily targets, and watch your adherence trend over time.', tag: 'Calorie Tracker' },
    { icon: <TrendingUp className="h-6 w-6" />, title: 'Progress Analytics', description: 'Weight trend charts, intake averages, plateau detection — everything you need to stay on track.', tag: 'Dashboard' },
    { icon: <Scale className="h-6 w-6" />, title: 'Adaptive Targets', description: 'Your calorie target updates automatically as the algorithm learns your real TDEE from logged data.', tag: 'Auto-Adjust' },
    { icon: <Calendar className="h-6 w-6" />, title: 'AI Nutrition Coach', description: 'Chat with an on-device AI assistant trained on your personal data for contextual nutrition advice.', tag: 'AI Chat' },
  ];

  const steps = [
    { num: '01', title: 'Set Up Your Profile', desc: 'Enter your stats, activity level, and goal. The system immediately calculates your baseline targets using the Mifflin-St Jeor equation.' },
    { num: '02', title: 'Log & Generate', desc: 'Generate personalised meal plans with a click. Log your meals and weight daily — the more data, the smarter it gets.' },
    { num: '03', title: 'Auto-Optimise', desc: 'Bayesian updating analyses your actual weight response to refine your true TDEE. Targets shift automatically.' },
  ];

  return (
    <div className="landing-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

        .landing-root {
          --lc-bg: #f8fafc;
          --lc-surface: #ffffff;
          --lc-dark: #0f172a;
          --lc-text: #1e293b;
          --lc-text-mid: #475569;
          --lc-text-muted: #64748b;
          --lc-text-subtle: #94a3b8;
          --lc-text-faint: #cbd5e1;
          --lc-border: #e2e8f0;
          --lc-surface-2: #f1f5f9;
          --lc-bar: #334155;

          font-family: 'DM Sans', sans-serif;
          background: var(--lc-bg);
          color: var(--lc-text);
          min-height: 100vh;
          overflow-x: hidden;
        }
        .nav {
          position: sticky; top: 0; z-index: 100;
          padding: 0 2rem; height: 64px;
          display: flex; align-items: center; justify-content: space-between;
          background: var(--lc-bg);
          transition: all 0.3s ease;
        }
        .nav.scrolled {
          background: rgba(248,250,252,0.92);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid var(--lc-border);
          box-shadow: 0 1px 8px rgba(0,0,0,0.04);
        }
        .nav-logo { display: flex; align-items: center; gap: 10px; }
        .nav-logo-icon { width: 36px; height: 36px; background: var(--lc-text); border-radius: 8px; display: flex; align-items: center; justify-content: center; }
        .nav-logo-name { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 1.05rem; color: var(--lc-text); letter-spacing: 0.02em; }
        .nav-logo-sub { font-size: 0.62rem; color: var(--lc-text-subtle); letter-spacing: 0.08em; text-transform: uppercase; }
        .nav-actions { display: flex; gap: 0.75rem; align-items: center; }

        .hero { max-width: 1100px; margin: 0 auto; padding: 6rem 2rem 4rem; text-align: center; position: relative; }
        .hero-badge { display: inline-flex; align-items: center; gap: 8px; padding: 5px 14px; background: var(--lc-surface-2); border: 1px solid var(--lc-border); border-radius: 100px; font-size: 0.75rem; color: var(--lc-text-muted); letter-spacing: 0.06em; text-transform: uppercase; font-weight: 500; margin-bottom: 2rem; }
        .hero-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--lc-text-muted); animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .hero-title { font-family: 'Syne', sans-serif; font-size: clamp(2.6rem, 6vw, 4.2rem); font-weight: 800; line-height: 1.05; letter-spacing: -0.02em; margin-bottom: 1.5rem; color: var(--lc-dark); }
        .hero-title .accent { color: var(--lc-text-mid); }
        .hero-subtitle { font-size: 1.08rem; color: var(--lc-text-muted); max-width: 540px; margin: 0 auto 2.5rem; line-height: 1.7; font-weight: 300; }
        .hero-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }

        .hero-mockup { max-width: 800px; margin: 4rem auto 0; border-radius: 14px; overflow: hidden; border: 1px solid var(--lc-border); background: var(--lc-surface); box-shadow: 0 20px 60px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.04); }
        .mockup-bar { background: var(--lc-bg); padding: 10px 16px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--lc-border); }
        .mockup-dot { width: 10px; height: 10px; border-radius: 50%; }
        .mockup-url { flex: 1; background: var(--lc-surface); border: 1px solid var(--lc-border); border-radius: 6px; padding: 3px 12px; font-size: 0.7rem; color: var(--lc-text-subtle); margin: 0 10px; }
        .mockup-body { padding: 1.25rem; display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; }
        .mock-card { background: var(--lc-bg); border-radius: 10px; padding: 0.9rem; border: 1px solid var(--lc-border); }
        .mock-card-label { font-size: 0.68rem; color: var(--lc-text-subtle); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
        .mock-card-value { font-family: 'Syne', sans-serif; font-size: 1.4rem; font-weight: 700; color: var(--lc-text); }
        .mock-card-sub { font-size: 0.68rem; color: var(--lc-text-muted); margin-top: 2px; }
        .mock-bar-wrap { grid-column: 1 / -1; background: var(--lc-bg); border-radius: 10px; padding: 0.9rem 1.1rem; border: 1px solid var(--lc-border); display: flex; flex-direction: column; gap: 8px; }
        .mock-bar-row { display: flex; align-items: center; gap: 10px; }
        .mock-bar-name { font-size: 0.7rem; color: var(--lc-text-muted); width: 56px; }
        .mock-bar-track { flex: 1; height: 5px; background: var(--lc-border); border-radius: 99px; overflow: hidden; }
        .mock-bar-fill { height: 100%; border-radius: 99px; background: var(--lc-bar); }
        .mock-bar-val { font-size: 0.7rem; color: var(--lc-text-subtle); width: 36px; text-align: right; }

        .section { max-width: 1100px; margin: 0 auto; padding: 5rem 2rem; }
        .section-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--lc-text-muted); font-weight: 600; margin-bottom: 0.6rem; }
        .section-title { font-family: 'Syne', sans-serif; font-size: clamp(1.8rem, 3.5vw, 2.5rem); font-weight: 700; color: var(--lc-dark); line-height: 1.15; margin-bottom: 0.9rem; }
        .section-desc { color: var(--lc-text-muted); font-size: 0.95rem; line-height: 1.7; max-width: 500px; font-weight: 300; }

        .stats-section { background: var(--lc-surface); border-top: 1px solid var(--lc-border); border-bottom: 1px solid var(--lc-border); }
        .stats-inner { max-width: 1100px; margin: 0 auto; padding: 3.5rem 2rem; display: grid; grid-template-columns: repeat(4,1fr); gap: 2rem; }
        @media(max-width:768px){.stats-inner{grid-template-columns:1fr 1fr;}}
        .stat-card { text-align: center; }
        .stat-number { font-family: 'Syne', sans-serif; font-size: 2.6rem; font-weight: 800; color: var(--lc-dark); line-height: 1; margin-bottom: 0.4rem; }
        .stat-label { font-size: 0.8rem; color: var(--lc-text-subtle); letter-spacing: 0.04em; }

        .features-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 1px; background: var(--lc-border); border: 1px solid var(--lc-border); border-radius: 14px; overflow: hidden; margin-top: 3rem; }
        @media(max-width:768px){.features-grid{grid-template-columns:1fr;}}
        .feature-cell { background: var(--lc-surface); padding: 2rem; transition: background 0.2s; }
        .feature-cell:hover { background: var(--lc-bg); }
        .feature-tag { font-size: 0.63rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--lc-text-subtle); font-weight: 600; margin-bottom: 1rem; }
        .feature-icon { width: 38px; height: 38px; background: var(--lc-surface-2); border-radius: 9px; display: flex; align-items: center; justify-content: center; color: var(--lc-text-mid); margin-bottom: 0.9rem; }
        .feature-title { font-family: 'Syne', sans-serif; font-size: 0.95rem; font-weight: 700; color: var(--lc-text); margin-bottom: 0.45rem; }
        .feature-desc { font-size: 0.85rem; color: var(--lc-text-muted); line-height: 1.65; }

        .steps-wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: center; }
        @media(max-width:768px){.steps-wrap{grid-template-columns:1fr;gap:2rem;}}
        .step-item { display: flex; gap: 1.25rem; padding: 1.4rem 0; border-bottom: 1px solid var(--lc-surface-2); cursor: pointer; }
        .step-item:last-child { border-bottom: none; }
        .step-num { font-family: 'Syne', sans-serif; font-size: 0.7rem; font-weight: 800; color: var(--lc-text-faint); letter-spacing: 0.08em; padding-top: 2px; min-width: 26px; transition: color 0.2s; }
        .step-item.active .step-num { color: var(--lc-text); }
        .step-item-title { font-family: 'Syne', sans-serif; font-size: 0.95rem; font-weight: 700; color: var(--lc-text-subtle); transition: color 0.2s; }
        .step-item.active .step-item-title { color: var(--lc-text); }
        .step-item-desc { font-size: 0.85rem; color: var(--lc-text-subtle); line-height: 1.65; max-height: 0; overflow: hidden; transition: max-height 0.4s ease, color 0.2s, margin 0.2s; }
        .step-item.active .step-item-desc { color: var(--lc-text-muted); max-height: 100px; margin-top: 0.4rem; }

        .steps-visual { background: var(--lc-surface); border-radius: 14px; border: 1px solid var(--lc-border); padding: 2.5rem; min-height: 260px; display: flex; flex-direction: column; justify-content: center; box-shadow: 0 4px 24px rgba(0,0,0,0.04); }
        .visual-step-num { font-family: 'Syne', sans-serif; font-size: 4.5rem; font-weight: 800; color: var(--lc-surface-2); line-height: 1; margin-bottom: 0.4rem; }
        .visual-step-title { font-family: 'Syne', sans-serif; font-size: 1.3rem; font-weight: 700; color: var(--lc-text); margin-bottom: 0.65rem; }
        .visual-step-desc { font-size: 0.875rem; color: var(--lc-text-muted); line-height: 1.7; }
        .visual-check { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--lc-text-subtle); margin-top: 1.25rem; }
        .check-icon { width: 18px; height: 18px; background: var(--lc-surface-2); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--lc-text-mid); flex-shrink: 0; }

        .cta-section { max-width: 860px; margin: 0 auto; padding: 4rem 2rem 6rem; text-align: center; }
        .cta-box { background: var(--lc-text); border-radius: 18px; padding: 4rem; position: relative; overflow: hidden; }
        .cta-title { font-family: 'Syne', sans-serif; font-size: 2rem; font-weight: 800; color: var(--lc-surface); margin-bottom: 0.75rem; }
        .cta-desc { color: var(--lc-text-subtle); font-size: 0.95rem; margin-bottom: 2rem; }
        .cta-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
        .btn-cta-primary { display: inline-flex; align-items: center; gap: 8px; background: var(--lc-surface); color: var(--lc-text); padding: 0.8rem 1.8rem; border-radius: 10px; font-size: 0.9rem; font-family: 'DM Sans', sans-serif; font-weight: 600; border: none; cursor: pointer; transition: all 0.2s; }
        .btn-cta-primary:hover { background: var(--lc-surface-2); }
        .btn-cta-secondary { display: inline-flex; align-items: center; gap: 8px; background: transparent; color: var(--lc-text-subtle); padding: 0.8rem 1.8rem; border-radius: 10px; font-size: 0.9rem; font-family: 'DM Sans', sans-serif; font-weight: 500; border: 1px solid rgba(255,255,255,0.12); cursor: pointer; transition: all 0.2s; }
        .btn-cta-secondary:hover { border-color: rgba(255,255,255,0.25); color: var(--lc-text-faint); }
        .cta-features { display: flex; gap: 1.5rem; justify-content: center; margin-top: 1.5rem; flex-wrap: wrap; }
        .cta-feat { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--lc-text-muted); }
        .check-icon-light { width: 16px; height: 16px; background: rgba(255,255,255,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--lc-text-subtle); flex-shrink: 0; }

        .footer { border-top: 1px solid var(--lc-border); padding: 2rem; max-width: 1100px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; }
        .footer-brand { display: flex; align-items: center; gap: 10px; }
        .footer-name { font-family: 'Syne', sans-serif; font-weight: 800; font-size: 0.9rem; color: var(--lc-text); }
        .footer-tagline { font-size: 0.62rem; color: var(--lc-text-subtle); text-transform: uppercase; letter-spacing: 0.08em; }
        .footer-copy { font-size: 0.78rem; color: var(--lc-text-faint); }
        .divider { border: none; border-top: 1px solid var(--lc-surface-2); margin: 0; }
      `}</style>

      {/* Nav */}
      <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="nav-logo">
          <div className="nav-logo-icon"><Activity className="h-5 w-5 text-white" /></div>
          <div>
            <div className="nav-logo-name">ANMS</div>
            <div className="nav-logo-sub">Adaptive Nutrition</div>
          </div>
        </div>
        <div className="nav-actions">
          <Button variant="outline" size="sm" onClick={() => onNavigate('login')}>Sign in</Button>
          <Button size="sm" onClick={() => onNavigate('register')}>Get Started →</Button>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-badge">
          <div className="hero-badge-dot" />
          University Capstone Project · 2026
        </div>
        <h1 className="hero-title">
          Nutrition that learns<br />from <span className="accent">your body</span>
        </h1>
        <p className="hero-subtitle">
          ANMS combines Bayesian statistics with personalised meal planning to continuously refine your calorie targets based on real weight response data.
        </p>
        <div className="hero-actions">
          <Button size="lg" onClick={() => onNavigate('register')}>
            Create free account <ArrowRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="lg" onClick={() => onNavigate('login')}>
            Sign in to dashboard
          </Button>
        </div>
        <div className="hero-mockup">
          <div className="mockup-bar">
            <div className="mockup-dot" style={{ background: '#ff5f57' }} />
            <div className="mockup-dot" style={{ background: '#febc2e' }} />
            <div className="mockup-dot" style={{ background: '#28c840' }} />
            <div className="mockup-url">anms.app / dashboard</div>
          </div>
          <div className="mockup-body">
            {[
              { label: 'Calories', value: '2,190', sub: 'of 2,400 target' },
              { label: 'Protein', value: '148g', sub: 'of 160g target' },
              { label: 'TDEE Est.', value: '2,610', sub: '↓ 40 from last week' },
              { label: 'Weight Δ', value: '−0.4', sub: 'kg this week' },
            ].map(c => (
              <div key={c.label} className="mock-card">
                <div className="mock-card-label">{c.label}</div>
                <div className="mock-card-value">{c.value}</div>
                <div className="mock-card-sub">{c.sub}</div>
              </div>
            ))}
            <div className="mock-bar-wrap">
              <div style={{ fontSize: '0.7rem', color: 'var(--lc-text-subtle)', marginBottom: 4 }}>Macro Breakdown</div>
              {[{ name: 'Protein', pct: 92, label: '148g' }, { name: 'Carbs', pct: 78, label: '312g' }, { name: 'Fat', pct: 85, label: '68g' }].map(m => (
                <div key={m.name} className="mock-bar-row">
                  <div className="mock-bar-name">{m.name}</div>
                  <div className="mock-bar-track"><div className="mock-bar-fill" style={{ width: `${m.pct}%` }} /></div>
                  <div className="mock-bar-val">{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <div className="stats-section">
        <div className="stats-inner">
          <StatCard value={95}   suffix="%" label="Prediction Accuracy" delay={0} />
          <StatCard value={8294} suffix="+" label="Foods in Database"   delay={100} />
          <StatCard value={50}   suffix="+" label="Tracked Metrics"     delay={200} />
          <StatCard value={3}    suffix=" sec" label="Plan Generation"  delay={300} />
        </div>
      </div>

      {/* Features */}
      <section className="section">
        <div className="section-label">What's inside</div>
        <div className="section-title">Every tool you need,<br />nothing you don't</div>
        <p className="section-desc">Six integrated modules designed to work together — from meal generation to Bayesian target adjustment.</p>
        <div className="features-grid">
          {features.map((f, i) => (
            <div key={i} className="feature-cell">
              <div className="feature-tag">{f.tag}</div>
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-title">{f.title}</div>
              <div className="feature-desc">{f.description}</div>
            </div>
          ))}
        </div>
      </section>

      <hr className="divider" />

      {/* How it works */}
      <section className="section">
        <div className="steps-wrap">
          <div>
            <div className="section-label">How it works</div>
            <div className="section-title" style={{ marginBottom: '2rem' }}>Three steps to<br />smarter nutrition</div>
            <div>
              {steps.map((s, i) => (
                <div key={i} className={`step-item ${activeStep === i ? 'active' : ''}`} onClick={() => setActiveStep(i)}>
                  <div className="step-num">{s.num}</div>
                  <div>
                    <div className="step-item-title">{s.title}</div>
                    <div className="step-item-desc">{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="steps-visual">
            <div className="visual-step-num">{steps[activeStep].num}</div>
            <div className="visual-step-title">{steps[activeStep].title}</div>
            <div className="visual-step-desc">{steps[activeStep].desc}</div>
            <div className="visual-check">
              <div className="check-icon"><Check className="h-3 w-3" /></div>
              {activeStep === 0 && 'Mifflin-St Jeor baseline calculation'}
              {activeStep === 1 && 'USDA-backed food database with 8,000+ items'}
              {activeStep === 2 && 'Bayesian posterior updating on every weight log'}
            </div>
          </div>
        </div>
      </section>

      <hr className="divider" />

      {/* CTA */}
      <div className="cta-section">
        <div className="cta-box">
          <div className="cta-title">Start optimising today</div>
          <div className="cta-desc">Free to use. No credit card. Built for people serious about their nutrition.</div>
          <div className="cta-actions">
            <button className="btn-cta-primary" onClick={() => onNavigate('register')}>
              Create your account <ArrowRight className="h-4 w-4" />
            </button>
            <button className="btn-cta-secondary" onClick={() => onNavigate('login')}>
              Already have an account
            </button>
          </div>
          <div className="cta-features">
            {['Personalised meal plans', 'Bayesian TDEE tracking', 'AI nutrition coach', 'No ads ever'].map(feat => (
              <div key={feat} className="cta-feat">
                <div className="check-icon-light"><Check className="h-3 w-3" /></div>
                {feat}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--lc-border)' }}>
        <div className="footer">
          <div className="footer-brand">
            <div className="nav-logo-icon"><Activity className="h-4 w-4 text-white" /></div>
            <div>
              <div className="footer-name">ANMS</div>
              <div className="footer-tagline">Adaptive Nutrition Management System</div>
            </div>
          </div>
          <div className="footer-copy">© 2026 University Capstone Project · Athens</div>
        </div>
      </footer>
    </div>
  );
}
