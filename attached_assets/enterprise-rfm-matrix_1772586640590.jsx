import { useState } from "react";

const data = [
  { r:"High",f:"High",m:"High",label:"Champions",color:"#0f766e",bg:"#f0fdfa",border:"#99f6e4",action:"Protect & Expand",signals:"Multiple stakeholders active across departments, strong usage, large current spend with room to grow",playbook:"Executive sponsorship, strategic QBRs, co-development opportunities, case study candidates, proactive expansion plays",icon:"\u{1F3C6}",p:1},
  { r:"High",f:"High",m:"Low",label:"Underleveraged",color:"#1d4ed8",bg:"#eff6ff",border:"#93c5fd",action:"Expand Wallet",signals:"Highly engaged, multi-threaded, but spending well below addressable wallet share",playbook:"Whitespace analysis, cross-sell campaigns, executive business reviews focused on ROI of expansion, land-and-expand into new departments",icon:"\u{1F4C8}",p:3},
  { r:"High",f:"Low",m:"High",label:"Single-Threaded Risk",color:"#c2410c",bg:"#fff7ed",border:"#fdba74",action:"Multi-Thread Now",signals:"Big account, recent activity, but only 1-2 contacts engaged. Champion dependency = churn risk",playbook:"Urgent multi-threading campaign, executive alignment meetings, expand user base across departments, map the full buying committee",icon:"\u26A0\uFE0F",p:4},
  { r:"High",f:"Low",m:"Low",label:"Early Stage",color:"#6d28d9",bg:"#f5f3ff",border:"#c4b5fd",action:"Qualify or Disqualify",signals:"Recent engagement but narrow and small. Could be early pipeline or a tire kicker",playbook:"Discovery calls, ICP validation, POC or pilot offer, set clear next steps with timelines to test seriousness",icon:"\u{1F50D}",p:5},
  { r:"Low",f:"High",m:"High",label:"Going Dark",color:"#dc2626",bg:"#fef2f2",border:"#fca5a5",action:"Rescue Immediately",signals:"Historically strong account with broad engagement that has recently gone quiet. Highest churn risk segment",playbook:"Executive-to-executive outreach, emergency QBR, voice-of-customer interviews, proactive renewal discussion, competitive displacement defense",icon:"\u{1F6A8}",p:2},
  { r:"Low",f:"Low",m:"High",label:"Sleeping Giant",color:"#be123c",bg:"#fff1f2",border:"#fda4af",action:"Re-Engage Urgently",signals:"High-value contract but no meaningful engagement. Renewal at serious risk \u2014 likely evaluating alternatives",playbook:"C-suite intervention, new value proposition, reactivation campaign with business case refresh, consider strategic concessions to re-engage",icon:"\u{1F4A4}",p:3},
  { r:"Low",f:"High",m:"Low",label:"Fading Interest",color:"#a16207",bg:"#fefce8",border:"#fde047",action:"Nurture or Deprioritize",signals:"Was broadly engaged but recency dropped and spend is low. Interest may have peaked without converting",playbook:"Automated nurture sequence, targeted content based on past engagement patterns, periodic check-ins but don't over-invest",icon:"\u{1F4C9}",p:6},
  { r:"Low",f:"Low",m:"Low",label:"Dead Zone",color:"#57534e",bg:"#fafaf9",border:"#d6d3d1",action:"Archive & Reallocate",signals:"No engagement, no multi-threading, low value. Not your ICP or a lost cause",playbook:"Move to automated-only nurture, free up AE/CSM capacity for higher-value segments, revisit quarterly with light-touch outreach only",icon:"\u{1FAA6}",p:8},
];

const sorted = [...data].sort((a,b) => a.p - b.p);

export default function App() {
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("matrix");

  const Cell = ({r,f,m}) => {
    const c = data.find(d => d.r===r && d.f===f && d.m===m);
    if(!c) return null;
    const sel = selected?.label === c.label;
    return (
      <button onClick={() => setSelected(sel ? null : c)} style={{background:sel?c.border:c.bg,border:`2px solid ${c.border}`,borderRadius:10,padding:"14px 12px",cursor:"pointer",transition:"all 0.2s",textAlign:"left",minHeight:110,display:"flex",flexDirection:"column",gap:6,transform:sel?"scale(1.02)":"scale(1)",boxShadow:sel?`0 4px 20px ${c.border}80`:"0 1px 3px rgba(0,0,0,0.06)",width:"100%"}}>
        <div style={{fontSize:20}}>{c.icon}</div>
        <div style={{fontWeight:700,fontSize:13,color:c.color}}>{c.label}</div>
        <div style={{fontFamily:"monospace",fontSize:10.5,color:c.color,opacity:0.8,fontWeight:500}}>{c.action}</div>
      </button>
    );
  };

  const Detail = ({c}) => (
    <div style={{background:c.bg,border:`2px solid ${c.border}`,borderRadius:12,padding:24,marginTop:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:28}}>{c.icon}</span>
            <h3 style={{fontSize:22,fontWeight:700,color:c.color,margin:0}}>{c.label}</h3>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
            {["R","F","M"].map((dim,i) => {
              const val = [c.r,c.f,c.m][i];
              const full = ["Recency","Frequency","Monetary"][i];
              return <span key={dim} style={{fontFamily:"monospace",fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:6,background:val==="High"?`${c.color}18`:"#f5f5f4",color:val==="High"?c.color:"#78716c",border:`1px solid ${val==="High"?`${c.color}30`:"#e7e5e4"}`}}>{full}: {val}</span>;
            })}
          </div>
        </div>
        <button onClick={() => setSelected(null)} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#a8a29e",padding:4}}>{"\u2715"}</button>
      </div>
      <div style={{marginTop:20}}>
        <div style={{marginBottom:16}}>
          <div style={{fontFamily:"monospace",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#a8a29e",marginBottom:6}}>What This Looks Like</div>
          <p style={{fontSize:14,lineHeight:1.6,color:"#44403c",margin:0}}>{c.signals}</p>
        </div>
        <div>
          <div style={{fontFamily:"monospace",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#a8a29e",marginBottom:6}}>Playbook</div>
          <p style={{fontSize:14,lineHeight:1.6,color:"#44403c",margin:0}}>{c.playbook}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",maxWidth:900,margin:"0 auto",padding:"32px 24px",background:"#fafaf9",minHeight:"100vh"}}>
      <div style={{marginBottom:32}}>
        <h1 style={{fontSize:28,fontWeight:700,color:"#1c1917",margin:"0 0 6px 0",letterSpacing:"-0.02em"}}>Enterprise RFM Matrix</h1>
        <p style={{fontFamily:"monospace",fontSize:12,color:"#a8a29e",margin:0}}>{"Recency \u00D7 Frequency \u00D7 Monetary \u2014 adapted for long enterprise sales cycles"}</p>
      </div>

      <div style={{display:"flex",gap:4,marginBottom:24}}>
        {["matrix","priority"].map(v => (
          <button key={v} onClick={() => {setView(v);setSelected(null);}} style={{fontFamily:"monospace",fontSize:11,fontWeight:600,padding:"6px 16px",borderRadius:6,border:"1px solid #e7e5e4",background:view===v?"#1c1917":"white",color:view===v?"white":"#78716c",cursor:"pointer"}}>
            {v==="matrix"?"Matrix View":"Priority Stack"}
          </button>
        ))}
      </div>

      {view === "matrix" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr"}}>
            <div/>
            <div style={{textAlign:"center",padding:"0 0 12px",fontFamily:"monospace",fontSize:11,fontWeight:700,color:"#78716c",textTransform:"uppercase",letterSpacing:"0.05em"}}>High Monetary</div>
            <div style={{textAlign:"center",padding:"0 0 12px",fontFamily:"monospace",fontSize:11,fontWeight:700,color:"#78716c",textTransform:"uppercase",letterSpacing:"0.05em"}}>Low Monetary</div>

            <div style={{writingMode:"vertical-rl",transform:"rotate(180deg)",textAlign:"center",padding:"0 12px 0 0",fontFamily:"monospace",fontSize:11,fontWeight:700,color:"#78716c",textTransform:"uppercase",letterSpacing:"0.05em",gridRow:"2/3",display:"flex",alignItems:"center",justifyContent:"center"}}>High Recency</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:6}}>
              <Cell r="High" f="High" m="High"/><Cell r="High" f="Low" m="High"/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:6}}>
              <Cell r="High" f="High" m="Low"/><Cell r="High" f="Low" m="Low"/>
            </div>

            <div style={{writingMode:"vertical-rl",transform:"rotate(180deg)",textAlign:"center",padding:"0 12px 0 0",fontFamily:"monospace",fontSize:11,fontWeight:700,color:"#78716c",textTransform:"uppercase",letterSpacing:"0.05em",gridRow:"3/4",display:"flex",alignItems:"center",justifyContent:"center"}}>Low Recency</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:6}}>
              <Cell r="Low" f="High" m="High"/><Cell r="Low" f="Low" m="High"/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:6}}>
              <Cell r="Low" f="High" m="Low"/><Cell r="Low" f="Low" m="Low"/>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr",marginTop:4}}>
            <div style={{width:30}}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",textAlign:"center"}}>
              <span style={{fontFamily:"monospace",fontSize:10,color:"#a8a29e"}}>High Freq</span>
              <span style={{fontFamily:"monospace",fontSize:10,color:"#a8a29e"}}>Low Freq</span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",textAlign:"center"}}>
              <span style={{fontFamily:"monospace",fontSize:10,color:"#a8a29e"}}>High Freq</span>
              <span style={{fontFamily:"monospace",fontSize:10,color:"#a8a29e"}}>Low Freq</span>
            </div>
          </div>
        </div>
      )}

      {view === "priority" && (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {sorted.map(c => (
            <button key={c.label} onClick={() => setSelected(selected?.label===c.label?null:c)} style={{background:selected?.label===c.label?c.border:c.bg,border:`2px solid ${c.border}`,borderRadius:10,padding:"16px 20px",cursor:"pointer",textAlign:"left",display:"flex",alignItems:"center",gap:16}}>
              <span style={{fontSize:24}}>{c.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:14,color:c.color}}>{c.label}</div>
                <div style={{fontFamily:"monospace",fontSize:11,color:c.color,opacity:0.7}}>{c.action}</div>
              </div>
              <div style={{display:"flex",gap:6}}>
                {["R","F","M"].map((dim,i) => {
                  const val = [c.r,c.f,c.m][i];
                  return <span key={dim} style={{fontFamily:"monospace",fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:4,background:val==="High"?`${c.color}18`:"#f5f5f4",color:val==="High"?c.color:"#a8a29e"}}>{dim}{val==="High"?"\u2191":"\u2193"}</span>;
                })}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && <Detail c={selected}/>}

      <div style={{marginTop:32,padding:20,background:"white",borderRadius:10,border:"1px solid #e7e5e4"}}>
        <div style={{fontFamily:"monospace",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",color:"#a8a29e",marginBottom:10}}>Enterprise RFM Definitions</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16}}>
          {[
            {d:"R \u2014 Recency",t:"Last high-intent action by a qualified stakeholder. Not purchase date \u2014 engagement date."},
            {d:"F \u2014 Frequency",t:"Breadth of multi-threaded engagement across stakeholders and departments. Not activity count."},
            {d:"M \u2014 Monetary",t:"Current spend relative to total addressable wallet. Value \u00D7 expansion potential."},
          ].map(x => (
            <div key={x.d}>
              <div style={{fontSize:13,fontWeight:700,color:"#1c1917",marginBottom:4}}>{x.d}</div>
              <div style={{fontSize:12,color:"#78716c",lineHeight:1.5}}>{x.t}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
