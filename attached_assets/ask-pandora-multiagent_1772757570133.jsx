import { useState, useEffect, useRef } from "react";

const AGENTS = {
  orchestrator: {
    id: "orchestrator",
    name: "Pandora",
    role: "Orchestrator",
    avatar: "🔮",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.12)",
    border: "rgba(167,139,250,0.3)",
  },
  pipeline: {
    id: "pipeline",
    name: "Pipeline",
    role: "Pipeline Agent",
    avatar: "📊",
    color: "#34d399",
    bg: "rgba(52,211,153,0.10)",
    border: "rgba(52,211,153,0.25)",
  },
  risk: {
    id: "risk",
    name: "Risk",
    role: "Risk Agent",
    avatar: "⚠️",
    color: "#fb923c",
    bg: "rgba(251,146,60,0.10)",
    border: "rgba(251,146,60,0.25)",
  },
  forecast: {
    id: "forecast",
    name: "Forecast",
    role: "Forecast Agent",
    avatar: "🎯",
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.10)",
    border: "rgba(96,165,250,0.25)",
  },
};

const SCENARIOS = {
  pipeline: [
    {
      agent: "orchestrator",
      type: "dispatch",
      text: "Breaking this down across agents. Pipeline → Risk → Forecast.",
      delay: 400,
    },
    {
      agent: "pipeline",
      type: "tool",
      tool: "query_deals",
      sql: "SELECT stage, SUM(amount) FROM deals WHERE close_date <= end_of_quarter GROUP BY stage",
      delay: 900,
    },
    {
      agent: "pipeline",
      type: "result",
      text: "Found 47 open deals totaling $2.4M. 12 in late stage (Proposal/Negotiation), 35 early/mid.",
      delay: 2200,
    },
    {
      agent: "risk",
      type: "tool",
      tool: "score_deals",
      sql: "SELECT deal_id, days_since_activity, stage_age FROM deals WHERE rfm_score < 40",
      delay: 2800,
    },
    {
      agent: "risk",
      type: "result",
      text: "8 deals flagged: 3 haven't moved stages in 45+ days, 5 have gone dark (no activity >21 days). Combined $680K at risk.",
      delay: 4100,
    },
    {
      agent: "forecast",
      type: "tool",
      tool: "tte_probability",
      sql: "SELECT avg_conversion_days, p50_close FROM stage_velocity WHERE stage IN ('Proposal','Negotiation')",
      delay: 4700,
    },
    {
      agent: "forecast",
      type: "result",
      text: "At current velocity, $1.1M is likely to close this quarter. TTE model gives 68% confidence on the top 5 deals.",
      delay: 6100,
    },
    {
      agent: "orchestrator",
      type: "synthesis",
      text: "Pipeline is $2.4M open, but only $1.1M on track. $680K is at serious risk — 8 deals need immediate attention. Your biggest lever this week is re-engaging those 5 dark deals before quarter end.",
      delay: 6800,
    },
  ],
  risk: [
    {
      agent: "orchestrator",
      type: "dispatch",
      text: "Risk scan in progress. Routing to Risk + Pipeline agents.",
      delay: 400,
    },
    {
      agent: "risk",
      type: "tool",
      tool: "detect_stalled_deals",
      sql: "SELECT * FROM deals WHERE stage_age > stage_p75_velocity AND close_date < NOW() + 30",
      delay: 900,
    },
    {
      agent: "pipeline",
      type: "tool",
      tool: "check_engagement",
      sql: "SELECT deal_id, last_activity_date, contact_count FROM deal_contacts WHERE last_touch > 14",
      delay: 1400,
    },
    {
      agent: "risk",
      type: "result",
      text: "11 deals are stalled past their P75 stage velocity. 4 of those are in Negotiation — historically the highest-value loss point.",
      delay: 2800,
    },
    {
      agent: "pipeline",
      type: "result",
      text: "6 deals have only 1 contact engaged. Multi-threading score is critically low on 3 top deals.",
      delay: 3600,
    },
    {
      agent: "orchestrator",
      type: "synthesis",
      text: "11 stalled deals, $920K total exposure. Prioritize the 4 Negotiation-stage deals — they represent 60% of risk value. Multi-threading gap on 3 top deals is your highest-leverage intervention.",
      delay: 4400,
    },
  ],
};

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 3, alignItems: "center", marginLeft: 4 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "#6b7280",
            animation: "pulse 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </span>
  );
}

function StreamingText({ text, active, onDone }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const idx = useRef(0);

  useEffect(() => {
    if (!active || !text) return;
    idx.current = 0;
    setDisplayed("");
    setDone(false);
    const interval = setInterval(() => {
      idx.current++;
      setDisplayed(text.slice(0, idx.current));
      if (idx.current >= text.length) {
        clearInterval(interval);
        setDone(true);
        onDone?.();
      }
    }, 18);
    return () => clearInterval(interval);
  }, [active, text]);

  return (
    <span>
      {displayed}
      {active && !done && <span style={{ opacity: 0.5 }}>▋</span>}
    </span>
  );
}

function ToolCallBubble({ tool, sql, agent }) {
  const ag = AGENTS[agent];
  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 11,
        background: "rgba(0,0,0,0.4)",
        border: `1px solid ${ag.border}`,
        borderRadius: 8,
        padding: "8px 12px",
        marginTop: 6,
        color: "#9ca3af",
        lineHeight: 1.6,
      }}
    >
      <div style={{ color: ag.color, fontSize: 10, letterSpacing: 1, marginBottom: 4, textTransform: "uppercase" }}>
        ⚙ {tool}
      </div>
      <div style={{ color: "#6b7280" }}>{sql}</div>
    </div>
  );
}

function AgentBubble({ msg, index }) {
  const [streaming, setStreaming] = useState(false);
  const [visible, setVisible] = useState(false);
  const ag = AGENTS[msg.agent];

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(true);
      if (msg.type !== "tool") setStreaming(true);
    }, 80);
    return () => clearTimeout(t);
  }, []);

  const isOrchestrator = msg.agent === "orchestrator";
  const isSynthesis = msg.type === "synthesis";
  const isDispatch = msg.type === "dispatch";

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "all 0.3s ease",
        marginBottom: 14,
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: ag.bg,
          border: `1.5px solid ${ag.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          flexShrink: 0,
          boxShadow: isSynthesis ? `0 0 12px ${ag.color}40` : "none",
        }}
      >
        {ag.avatar}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: ag.color,
              fontFamily: "'DM Mono', monospace",
            }}
          >
            {ag.name}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "#4b5563",
              background: "rgba(255,255,255,0.04)",
              padding: "1px 6px",
              borderRadius: 4,
              letterSpacing: 0.5,
            }}
          >
            {ag.role}
          </span>
          {(isDispatch || isSynthesis) && (
            <span
              style={{
                fontSize: 9,
                color: ag.color,
                background: ag.bg,
                border: `1px solid ${ag.border}`,
                padding: "1px 6px",
                borderRadius: 4,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              {isSynthesis ? "Answer" : "Routing"}
            </span>
          )}
        </div>

        <div
          style={{
            background: isSynthesis
              ? `linear-gradient(135deg, ${ag.bg}, rgba(167,139,250,0.06))`
              : ag.bg,
            border: `1px solid ${isSynthesis ? ag.color + "50" : ag.border}`,
            borderRadius: isSynthesis ? 12 : 10,
            padding: "10px 14px",
            fontSize: 13,
            color: isSynthesis ? "#e5e7eb" : "#d1d5db",
            lineHeight: 1.6,
            boxShadow: isSynthesis ? `0 2px 20px ${ag.color}20` : "none",
          }}
        >
          {msg.type === "tool" ? (
            <ToolCallBubble tool={msg.tool} sql={msg.sql} agent={msg.agent} />
          ) : (
            <StreamingText text={msg.text} active={streaming} />
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectorLine({ from, to }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "2px 46px",
        marginBottom: 6,
      }}
    >
      <div
        style={{
          height: 1,
          flex: 1,
          background: `linear-gradient(90deg, ${AGENTS[from]?.color}60, ${AGENTS[to]?.color}60)`,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -3,
            left: "50%",
            transform: "translateX(-50%)",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: AGENTS[to]?.color,
            animation: "ping 1s ease-out infinite",
          }}
        />
      </div>
    </div>
  );
}

const PROMPTS = [
  "What's our pipeline looking like?",
  "Which deals are at risk?",
  "How are reps tracking against quota?",
  "What changed this week?",
];

export default function AskPandoraMultiAgent() {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const bottomRef = useRef(null);
  const timers = useRef([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const runScenario = (q) => {
    clearTimers();
    const key = q.toLowerCase().includes("risk") ? "risk" : "pipeline";
    const steps = SCENARIOS[key];
    setMessages([]);
    setRunning(true);

    steps.forEach((step, i) => {
      const t = setTimeout(() => {
        setMessages((prev) => [...prev, { ...step, id: Date.now() + i }]);
        if (i === steps.length - 1) {
          setTimeout(() => setRunning(false), 1500);
        }
      }, step.delay);
      timers.current.push(t);
    });
  };

  const handleSubmit = () => {
    if (!query.trim() || running) return;
    runScenario(query);
    setQuery("");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0f",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', 'DM Sans', system-ui, sans-serif",
        color: "#e5e7eb",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap');
        @keyframes pulse { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }
        @keyframes ping { 0%{transform:translateX(-50%) scale(1);opacity:1} 100%{transform:translateX(-50%) scale(2.5);opacity:0} }
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes glow { 0%,100%{box-shadow:0 0 8px rgba(167,139,250,0.3)} 50%{box-shadow:0 0 20px rgba(167,139,250,0.6)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 4px; }
      `}</style>

      {/* Header */}
      <div
        style={{
          padding: "14px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "rgba(10,10,15,0.9)",
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "linear-gradient(135deg, #7c3aed, #2563eb)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
            }}
          >
            🔮
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: "#f3f4f6" }}>Ask Pandora</div>
            <div style={{ fontSize: 11, color: "#6b7280" }}>Multi-agent mode</div>
          </div>
        </div>

        {/* Agent roster */}
        <div style={{ display: "flex", gap: 6 }}>
          {Object.values(AGENTS).map((ag) => (
            <div
              key={ag.id}
              title={ag.role}
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: ag.bg,
                border: `1.5px solid ${ag.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                cursor: "default",
              }}
            >
              {ag.avatar}
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 0" }}>
        {messages.length === 0 && !running ? (
          /* Empty state */
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 400,
              gap: 8,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(37,99,235,0.3))",
                border: "1.5px solid rgba(167,139,250,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                marginBottom: 8,
                animation: "glow 3s ease-in-out infinite",
              }}
            >
              🔮
            </div>
            <div style={{ fontSize: 20, fontWeight: 600, color: "#f9fafb" }}>Ask Pandora</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
              Watch agents collaborate on your RevOps questions in real time
            </div>

            {/* Agent legend */}
            <div
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 24,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              {Object.values(AGENTS).map((ag) => (
                <div
                  key={ag.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: ag.bg,
                    border: `1px solid ${ag.border}`,
                    borderRadius: 20,
                    padding: "4px 12px",
                    fontSize: 11,
                    color: ag.color,
                  }}
                >
                  <span>{ag.avatar}</span>
                  <span>{ag.role}</span>
                </div>
              ))}
            </div>

            {/* Prompt suggestions */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 460 }}>
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => { setQuery(p); runScenario(p); }}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 10,
                    padding: "12px 16px",
                    color: "#d1d5db",
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = "rgba(167,139,250,0.08)";
                    e.target.style.borderColor = "rgba(167,139,250,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = "rgba(255,255,255,0.04)";
                    e.target.style.borderColor = "rgba(255,255,255,0.08)";
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 600, margin: "0 auto", paddingBottom: 20 }}>
            {/* Running indicator */}
            {running && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                  padding: "8px 14px",
                  background: "rgba(167,139,250,0.08)",
                  border: "1px solid rgba(167,139,250,0.2)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#a78bfa",
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    border: "2px solid rgba(167,139,250,0.3)",
                    borderTopColor: "#a78bfa",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                Agents working…
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={msg.id}>
                {/* Show handoff connector between different agents */}
                {i > 0 && messages[i - 1].agent !== msg.agent && (
                  <ConnectorLine from={messages[i - 1].agent} to={msg.agent} />
                )}
                <AgentBubble msg={msg} index={i} />
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div
        style={{
          padding: "12px 20px 16px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(10,10,15,0.95)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          style={{
            maxWidth: 600,
            margin: "0 auto",
            display: "flex",
            gap: 10,
            alignItems: "center",
            background: "rgba(255,255,255,0.05)",
            border: `1px solid ${inputFocused ? "rgba(167,139,250,0.4)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 12,
            padding: "6px 6px 6px 16px",
            transition: "border-color 0.2s",
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Ask a question…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#f3f4f6",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={running || !query.trim()}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: running || !query.trim() ? "rgba(167,139,250,0.2)" : "linear-gradient(135deg, #7c3aed, #4f46e5)",
              border: "none",
              cursor: running || !query.trim() ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#e5e7eb",
              fontSize: 14,
              transition: "all 0.15s",
            }}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}
