import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, Map, List, Activity } from 'lucide-react';

export default function Navigation() {
  const location = useLocation();

  const navItems = [
    { path: '/', label: 'ฟีดข่าว', icon: List },
    { path: '/map', label: 'แผนที่ความเสี่ยง', icon: Map },
  ];

  return (
    <header className="max-w-6xl mx-auto w-full flex flex-col sm:flex-row justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm gap-4 sticky top-4 z-10">
      <Link to="/" className="flex items-center gap-3">
        <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center text-white">
          <AlertTriangle className="h-6 w-6" strokeWidth={2} />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">DrunkDrive.th</h1>
          <p className="text-xs text-slate-500 font-medium">ระบบรวมข่าวอุบัติเหตุเมาแล้วขับ</p>
        </div>
      </Link>
      <div className="flex gap-2 items-center flex-wrap justify-center">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                isActive 
                  ? 'bg-slate-100 text-slate-800 border-slate-200' 
                  : 'bg-white text-slate-500 border-transparent hover:bg-slate-50 hover:border-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
        <div className="px-4 py-2 bg-red-600 rounded-lg text-xs font-bold text-white shadow-md flex items-center gap-1.5 ml-2">
          <Activity className="h-4 w-4" />
          LIVE FEED
        </div>
      </div>
    </header>
  );
}
