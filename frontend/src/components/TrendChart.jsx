import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const Tip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background:'#070d16', border:'1px solid #101e32', padding:'10px 14px', borderRadius:4, fontFamily:"'DM Mono',monospace", fontSize:11, boxShadow:'0 8px 24px rgba(0,0,0,0.5)' }}>
      <div style={{ color:'#3d5878', marginBottom:6, fontSize:10 }}>
        {new Date(label).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })}
      </div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color:p.color, display:'flex', justifyContent:'space-between', gap:16, marginBottom:2 }}>
          <span>{p.name}</span><strong>{p.value}</strong>
        </div>
      ))}
    </div>
  )
}

const Leg = ({ payload }) => (
  <div style={{ display:'flex', gap:20, justifyContent:'center', marginTop:10 }}>
    {payload.map(p => (
      <div key={p.value} style={{ display:'flex', alignItems:'center', gap:6, fontFamily:"'DM Mono',monospace", fontSize:10, color:'#3d5878' }}>
        <span style={{ width:16, height:2, background:p.color, display:'inline-block', borderRadius:1 }} />
        {p.value}
      </div>
    ))}
  </div>
)

export default function TrendChart({ data }) {
  const d = (data ?? []).map(r => ({
    week: r.week_start,
    'PRs Merged': r.prs_merged,
    'Reviews': r.reviews,
    'Commits': r.commits,
  }))
  return (
    <div style={{ width:'100%', height:240 }}>
      <ResponsiveContainer>
        <AreaChart data={d} margin={{ top:8, right:8, left:-22, bottom:0 }}>
          <defs>
            {[['p','#00c8f0'],['r','#9b72f6'],['c','#00e878']].map(([id,col]) => (
              <linearGradient key={id} id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={col} stopOpacity={0.22}/>
                <stop offset="95%" stopColor={col} stopOpacity={0}/>
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke="#101e32" />
          <XAxis dataKey="week" tickFormatter={v => new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric'})} tick={{fill:'#3d5878',fontSize:10,fontFamily:"'DM Mono',monospace"}} axisLine={{stroke:'#101e32'}} tickLine={false} />
          <YAxis tick={{fill:'#3d5878',fontSize:10,fontFamily:"'DM Mono',monospace"}} axisLine={false} tickLine={false} />
          <Tooltip content={<Tip />} />
          <Legend content={<Leg />} />
          <Area type="monotone" dataKey="PRs Merged" stroke="#00c8f0" fill="url(#gp)" strokeWidth={2} dot={false} activeDot={{r:4,fill:'#00c8f0'}} />
          <Area type="monotone" dataKey="Reviews" stroke="#9b72f6" fill="url(#gr)" strokeWidth={2} dot={false} activeDot={{r:4,fill:'#9b72f6'}} />
          <Area type="monotone" dataKey="Commits" stroke="#00e878" fill="url(#gc)" strokeWidth={2} dot={false} activeDot={{r:4,fill:'#00e878'}} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
