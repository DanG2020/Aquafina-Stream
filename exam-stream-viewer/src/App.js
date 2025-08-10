import React, { useEffect, useRef, useState } from 'react';
import './App.css';

function App() {
  const [connected, setConnected] = useState(false);
  const [notepadMode, setNotepadMode] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [serverHealth, setServerHealth] = useState('🔴 Offline');

  const [fps, setFps] = useState(0);                // ✅
  const [lastAgeMs, setLastAgeMs] = useState(null); // ✅

  const imgRef = useRef(null);
  const notesRef = useRef(null);

  // WebSocket (with reconnect)
  useEffect(() => {
    let ws;
    let reconnectTimer;

    const connect = () => {
      ws = new WebSocket('ws://localhost:3000');
      ws.onopen = () => setConnected(true);
      ws.onmessage = (event) => {
        const blob = new Blob([event.data], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        if (imgRef.current?.src) URL.revokeObjectURL(imgRef.current.src);
        if (imgRef.current) imgRef.current.src = url;
      };
      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 1000); // ✅ auto-reconnect
      };
    };
    connect();
    return () => clearTimeout(reconnectTimer);
  }, []);

  // Health + stats polling
  useEffect(() => {
    const poll = async () => {
      try {
        const h = await fetch('http://localhost:3000/health', { method: 'HEAD' });
        setServerHealth(h.ok ? '🟢 Fast' : '🔴 Offline');
      } catch {
        setServerHealth('🔴 Offline');
      }

      try {
        const r = await fetch('http://localhost:3000/stats');
        const s = await r.json();
        setFps(s.fps || 0);
        setLastAgeMs(s.lastFrameAt ? (Date.now() - s.lastFrameAt) : null);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, []);

  const copyNotes = () => navigator.clipboard.writeText(notesRef.current?.value || '');
  const downloadSnapshot = () => {
    const link = document.createElement('a');
    link.download = `snapshot-${Date.now()}.jpg`;
    link.href = imgRef.current?.src || '';
    link.click();
  };

  return (
    <div className={`app-container ${darkMode ? 'dark' : ''}`}>
      <header className="app-header">
        <div><h1>AQUAFINA</h1></div>
        <div className="toggles">
          <button onClick={() => setNotepadMode(!notepadMode)}>
            {notepadMode ? '📺 Fullscreen' : '📝 Notepad'}
          </button>
          <button onClick={() => setDarkMode(!darkMode)}>
            {darkMode ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </header>

      <div className="status-bar">
        <span>Status: <strong className={connected ? 'live' : 'offline'}>{connected ? 'Live' : 'Offline'}</strong></span>
        <span>Server: {serverHealth}</span>
        <span>FPS: {fps}</span>                      {/* ✅ */}
        <span>Age: {lastAgeMs == null ? '-' : `${lastAgeMs}ms`}</span> {/* ✅ */}
        <button onClick={downloadSnapshot}>Snapshot</button>
      </div>

      <div className={`content ${notepadMode ? 'dual' : 'single'}`}>
        <div className="video-box">
          <img ref={imgRef} alt="Live feed" />
        </div>
        {notepadMode && (
          <div className="notepad-box">
            <div className="notepad-header">
              <h3>Notes</h3>
              <button onClick={copyNotes} title="Copy to Clipboard">Copy</button>
            </div>
            <textarea ref={notesRef} placeholder="Type your observations..." />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
