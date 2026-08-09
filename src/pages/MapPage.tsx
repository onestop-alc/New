import { useState, useEffect } from 'react';
import { Map, AlertTriangle } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { fetchStories, type Story } from '../lib/api.js';

export default function MapPage() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStories()
      .then(data => {
        setStories(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
      </div>
    );
  }

  // Aggregate stats by province
  const provinceStats: Record<string, { count: number, deaths: number }> = {};
  
  stories.forEach(story => {
    if (story.provinces && story.provinces.length > 0) {
      story.provinces.forEach(prov => {
        if (!provinceStats[prov]) {
          provinceStats[prov] = { count: 0, deaths: 0 };
        }
        provinceStats[prov].count += 1;
        if (story.deaths) provinceStats[prov].deaths += story.deaths;
      });
    }
  });

  const chartData = Object.entries(provinceStats)
    .map(([name, stats]) => ({
      name,
      เหตุการณ์: stats.count,
      ผู้เสียชีวิต: stats.deaths
    }))
    .sort((a, b) => b.เหตุการณ์ - a.เหตุการณ์)
    .slice(0, 10); // Top 10

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-md rounded-xl text-sm">
          <p className="font-bold text-slate-800 mb-2">{label}</p>
          <div className="flex flex-col gap-1">
             <p className="text-slate-600 text-xs"><span className="inline-block w-3 h-3 rounded-sm bg-slate-800 mr-2"></span> เหตุการณ์: <span className="font-bold">{payload[0].value}</span></p>
             <p className="text-slate-600 text-xs"><span className="inline-block w-3 h-3 rounded-sm bg-red-500 mr-2"></span> ผู้เสียชีวิต: <span className="font-bold">{payload[1].value}</span></p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Map Heatmap Placeholder */}
      <section className="lg:col-span-8 bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col">
        <div className="flex justify-between items-center mb-6">
           <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <Map className="h-5 w-5 text-slate-400" />
              แผนที่ความเสี่ยง (Heatmap)
           </h3>
           <div className="flex gap-2">
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded">จาก {stories.length} ข่าวล่าสุด</span>
           </div>
        </div>
        
        <div className="flex-grow bg-slate-50 rounded-2xl relative flex items-center justify-center overflow-hidden min-h-[400px] border border-slate-100">
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
          {/* Symbolic Map Shape */}
          <div className="absolute w-[60%] h-[70%] bg-slate-200 rounded-[100px] blur-3xl opacity-50"></div>
          
          <div className="relative z-10 flex flex-col gap-3 p-4">
             {chartData.slice(0, 5).map((d, i) => (
                <div key={d.name} className="flex items-center gap-3 bg-white/80 backdrop-blur-sm p-2 rounded-xl border border-slate-200 shadow-sm" style={{ transform: `translateX(${i % 2 === 0 ? '-20px' : '20px'})` }}>
                  <span className={`w-3 h-3 rounded-full ${i === 0 ? 'bg-red-600 animate-pulse' : i < 3 ? 'bg-orange-500' : 'bg-amber-400'}`}></span>
                  <span className="text-[11px] font-bold text-slate-700">{d.name} <span className="text-slate-400 ml-1">({d.เหตุการณ์})</span></span>
                </div>
             ))}
             {chartData.length === 0 && (
                 <div className="text-center">
                    <AlertTriangle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                    <span className="text-xs font-bold text-slate-500">ไม่มีข้อมูลพื้นที่</span>
                 </div>
             )}
          </div>
        </div>
        
        <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
          <div className="flex items-center gap-2 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100">
              <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse"></span>
              <span className="text-[10px] font-bold text-red-700 uppercase">พื้นที่เฝ้าระวังสูงสุด: {chartData[0]?.name || 'ไม่ระบุ'}</span>
          </div>
        </div>
      </section>

      {/* Stats Bar Chart */}
      <section className="lg:col-span-4 bg-slate-900 rounded-3xl p-6 text-white flex flex-col shadow-sm">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-6">10 จังหวัดที่เกิดเหตุสูงสุด</h3>
        
        <div className="flex-grow bg-slate-800/50 rounded-2xl p-4 border border-slate-700/50 h-[400px]">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1e293b' }} />
                <Bar dataKey="เหตุการณ์" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={12}>
                   {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === 0 ? '#f87171' : index < 3 ? '#fb923c' : '#475569'} />
                   ))}
                </Bar>
                <Bar dataKey="ผู้เสียชีวิต" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={4} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-[10px] font-bold text-slate-500 uppercase tracking-widest">
               No Data Available
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
