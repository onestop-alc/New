/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navigation from './components/Navigation.js';
import Feed from './pages/Feed.js';
import StoryDetail from './pages/StoryDetail.js';
import MapPage from './pages/MapPage.js';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 sm:p-6 flex flex-col">
        <Navigation />
        <main className="max-w-6xl mx-auto w-full mt-6 flex-grow">
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/story/:id" element={<StoryDetail />} />
            <Route path="/map" element={<MapPage />} />
          </Routes>
        </main>
        {/* Footer Status Bar */}
        <footer className="mt-6 max-w-6xl w-full mx-auto flex flex-col sm:flex-row justify-between items-center text-[10px] text-slate-400 font-bold uppercase tracking-widest gap-2">
          <div className="flex items-center gap-4">
            <span>ดูดข่าวทุก 30 นาที</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Data Source: Google News RSS</span>
            <span className="text-slate-300">|</span>
            <span>Build v1.0.0</span>
          </div>
        </footer>
      </div>
    </Router>
  );
}

