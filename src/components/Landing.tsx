import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Plus, Zap, User, Lock, Mail, ArrowLeft, LogIn, Calendar, Clock, Eye, Trash2, Settings, History, Check, Copy } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type LandingState = "initial" | "login" | "guest" | "actions" | "create" | "join" | "create_account" | "schedule_success";

export default function Landing() {
  const [view, setView] = useState<LandingState>("initial");
  
  const [username, setUsername] = useState(localStorage.getItem("syncStream_username") || "");
  const [authId, setAuthId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  // Create room advanced config states
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState<"EPHEMERAL" | "PERMANENT">("EPHEMERAL");
  const [scheduledAt, setScheduledAt] = useState("");
  const [isLobbyEnabled, setIsLobbyEnabled] = useState(false);
  const [onlyHostSync, setOnlyHostSync] = useState(false);
  const [createdRoomId, setCreatedRoomId] = useState("");
  const [copiedLink, setCopiedLink] = useState(false);

  // Watch history lists
  const [recentRooms, setRecentRooms] = useState<any[]>([]);
  
  const navigate = useNavigate();

  useEffect(() => {
     if (username) {
         setView("actions");
     }
  }, [username]);

  const loadWatchlist = () => {
    if (username) {
      fetch(`/api/user/${username}/rooms`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setRecentRooms(data);
          }
        })
        .catch((err) => console.error("Error loading watch history:", err));
    }
  };

  useEffect(() => {
    loadWatchlist();
  }, [username, view]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: authId, password })
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("syncStream_username", data.username);
        setUsername(data.username);
        setView("actions");
      } else {
        const data = await res.json();
        setAuthError(data.error || "Login failed");
      }
    } catch (e) {
      setAuthError("Network error during login");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password })
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem("syncStream_username", data.username);
        setView("actions");
      } else {
        const data = await res.json();
        setAuthError(data.error || "Registration failed");
      }
    } catch (e) {
      setAuthError("Network error during registration");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) return;
    localStorage.setItem("syncStream_username", username);
    setView("actions");
  };

  const logout = () => {
    localStorage.removeItem("syncStream_username");
    setUsername("");
    setAuthId("");
    setPassword("");
    setRecentRooms([]);
    setView("initial");
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !youtubeUrl) return;

    setIsLoading(true);
    try {
      const sessionId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem("syncStream_sessionId", sessionId);

      const response = await fetch("/api/create-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: youtubeUrl,
          hostSessionId: sessionId,
          roomType,
          name: roomName || undefined,
          scheduledAt: scheduledAt || undefined,
          onlyHostSync,
          isLobbyEnabled
        }),
      });

      if (response.ok) {
        const { roomId } = await response.json();
        
        // Save to recent watchlist initially to register the creator
        await fetch("/api/user/recent-rooms/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            roomId,
            lastTimestamp: 0
          })
        }).catch(() => {});

        if (scheduledAt) {
          setCreatedRoomId(roomId);
          setView("schedule_success");
        } else {
          navigate(`/room/${roomId}`);
        }
      } else {
        const err = await response.json();
        alert(err.error || "Failed to create room");
      }
    } catch (error) {
      console.error(error);
      alert("Error creating room");
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !joinRoomId) return;
    navigate(`/room/${joinRoomId.toUpperCase().trim()}`);
  };

  const getGoogleCalendarUrl = (rid: string) => {
    const playUrl = `${window.location.origin}/room/${rid}`;
    const start = scheduledAt ? new Date(scheduledAt).toISOString().replace(/-|:|\.\d\d\d/g, "") : new Date().toISOString().replace(/-|:|\.\d\d\d/g, "");
    const end = scheduledAt ? new Date(new Date(scheduledAt).getTime() + 120 * 60 * 1000).toISOString().replace(/-|:|\.\d\d\d/g, "") : new Date(Date.now() + 120 * 60 * 1000).toISOString().replace(/-|:|\.\d\d\d/g, "");
    
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(roomName || 'CinemaSync Watch Party')}&dates=${start}/${end}&details=${encodeURIComponent('Join the synchronous cinema watch party here:\n' + playUrl)}&sf=true`;
  };

  const formatTrackTime = (seconds: number) => {
     if (!seconds) return "00:00";
     const h = Math.floor(seconds / 3600);
     const m = Math.floor((seconds % 3600) / 60);
     const s = Math.floor(seconds % 60);
     const pad = (n: number) => String(n).padStart(2, "0");
     if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
     return `${pad(m)}:${pad(s)}`;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 py-12 bg-[#050505] relative overflow-hidden font-sans">
      {/* Background Gradients */}
      <div className="absolute top-0 left-0 w-full h-full z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#9d4edd]/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 rounded-full blur-[120px]" />
      </div>

      <div className="w-full max-w-md space-y-10 relative z-10">
        <div className="space-y-6 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-[2rem] bg-[#9d4edd] shadow-[0_0_50px_rgba(157,78,221,0.4)] mb-2 relative group">
            <Zap className="w-10 h-10 text-white fill-current" />
            <div className="absolute inset-0 rounded-[2rem] bg-white opacity-0 group-hover:opacity-10 transition-opacity" />
          </div>
          <div className="space-y-2">
            <h1 className="text-5xl font-bold tracking-tight text-white sm:text-6xl">
              Gallery <span className="text-[#9d4edd]">Friends</span>
            </h1>
            <p className="text-white/40 text-sm font-mono tracking-widest uppercase">Cinematic Watch Party Engine</p>
          </div>
        </div>

        <div className="p-8 rounded-2xl glass shadow-2xl relative overflow-hidden min-h-[300px] flex flex-col justify-center">
          {/* subtle decorative edge */}
          <div className="absolute top-0 left-0 w-full h-[1px] bg-linear-to-r from-transparent via-white/10 to-transparent" />
          
          <AnimatePresence mode="wait">
            
            {view === "initial" && (
              <motion.div key="initial" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <button
                  onClick={() => setView("login")}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-[#9d4edd] hover:bg-[#8a3ec9] text-white font-bold text-xs uppercase tracking-[0.2em] rounded-xl transition-all shadow-glow"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Login to Account</span>
                </button>
                <div className="flex items-center gap-4 py-2">
                  <div className="flex-1 h-[1px] bg-white/5" />
                  <span className="text-[9px] text-white/20 font-bold uppercase tracking-[0.4em]">OR</span>
                  <div className="flex-1 h-[1px] bg-white/5" />
                </div>
                <button
                  onClick={() => setView("guest")}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-[0.2em] rounded-xl transition-all border border-white/5"
                >
                  <User className="w-4 h-4" />
                  <span>Use as Guest</span>
                </button>
              </motion.div>
            )}

            {view === "login" && (
              <motion.form key="login" onSubmit={handleLoginSubmit} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <button type="button" onClick={() => setView("initial")} className="flex items-center gap-2 text-[#9d4edd] text-[10px] font-bold uppercase tracking-widest hover:text-[#b366ff] transition-colors mb-4"><ArrowLeft className="w-3 h-3" /> Back</button>
                <div className="space-y-4">
                  {authError && <div className="text-red-400 text-xs text-center">{authError}</div>}
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input type="text" placeholder="USERNAME OR EMAIL" required className="w-full pl-12 pr-5 py-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-sm tracking-wider text-white" value={authId} onChange={(e) => setAuthId(e.target.value)} />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input type="password" placeholder="PASSWORD" required className="w-full pl-12 pr-5 py-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-sm tracking-wider text-white" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                </div>
                <button type="submit" disabled={!authId || !password || isLoading} className="w-full py-4 bg-[#9d4edd] hover:bg-[#8a3ec9] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-[0.3em] rounded-xl transition-all shadow-glow flex justify-center items-center">
                  {isLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Enter Gallery'}
                </button>
                <div className="text-center mt-4 text-xs font-mono text-white/50">
                   Don't have an account? <button type="button" onClick={() => setView("create_account")} className="text-[#9d4edd] hover:text-white transition-colors uppercase tracking-widest">Register</button>
                </div>
              </motion.form>
            )}

            {view === "create_account" as LandingState && (
              <motion.form key="create_account" onSubmit={handleRegisterSubmit} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <button type="button" onClick={() => setView("login")} className="flex items-center gap-2 text-[#9d4edd] text-[10px] font-bold uppercase tracking-widest hover:text-[#b366ff] transition-colors mb-4"><ArrowLeft className="w-3 h-3" /> Back to Login</button>
                <div className="space-y-4">
                  {authError && <div className="text-red-400 text-xs text-center">{authError}</div>}
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input type="text" placeholder="USERNAME" required className="w-full pl-12 pr-5 py-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-sm tracking-wider text-white" value={username} onChange={(e) => setUsername(e.target.value)} />
                  </div>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input type="email" placeholder="EMAIL" required className="w-full pl-12 pr-5 py-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-sm tracking-wider text-white" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input type="password" placeholder="PASSWORD" required className="w-full pl-12 pr-5 py-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-sm tracking-wider text-white" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                </div>
                <button type="submit" disabled={!username || !email || !password || isLoading} className="w-full py-4 bg-[#9d4edd] hover:bg-[#8a3ec9] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-[0.3em] rounded-xl transition-all shadow-glow flex justify-center items-center">
                   {isLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Create Account'}
                </button>
              </motion.form>
            )}

            {view === "guest" && (
              <motion.form key="guest" onSubmit={handleGuestSubmit} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <button type="button" onClick={() => setView("initial")} className="flex items-center gap-2 text-[#9d4edd] text-[10px] font-bold uppercase tracking-widest hover:text-[#b366ff] transition-colors mb-4"><ArrowLeft className="w-3 h-3" /> Back</button>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] ml-1">Guest Identity</label>
                  <input type="text" placeholder="DISPLAY NAME" required className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-sm tracking-wider text-white" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <button type="submit" disabled={!username} className="w-full py-4 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-[0.3em] rounded-xl transition-all">
                  Continue as {username || 'Guest'}
                </button>
              </motion.form>
            )}

            {view === "actions" && (
              <motion.div key="actions" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="space-y-4">
                <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
                  <div>
                    <p className="text-white/40 text-[9px] font-mono tracking-widest uppercase">Logged in as</p>
                    <p className="text-[#bf8bff] font-bold text-sm tracking-wide">{username}</p>
                  </div>
                  <button onClick={logout} className="text-red-400 text-[10px] font-bold tracking-widest hover:text-red-300 uppercase transition-colors">
                    Logout
                  </button>
                </div>
                
                <div className="grid grid-cols-2 gap-2.5">
                  <button onClick={() => setView("create")} className="flex flex-col items-center justify-center gap-2 p-5 bg-[#9d4edd] hover:bg-[#833bc4] text-white font-bold rounded-xl transition-all shadow-glow group">
                    <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    <span className="text-xs uppercase tracking-widest">Create Room</span>
                  </button>
                  <button onClick={() => setView("join")} className="flex flex-col items-center justify-center gap-2 p-5 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all border border-white/5 group">
                    <Play className="w-5 h-5 fill-current text-[#bf8bff] group-hover:scale-110 transition-transform" />
                    <span className="text-xs uppercase tracking-widest">Join Room</span>
                  </button>
                </div>

                {/* Continue Watching Dashboard */}
                {recentRooms.length > 0 && (
                  <div className="space-y-3 mt-6 border-t border-white/5 pt-5 max-h-[350px] overflow-y-auto pr-1">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 text-white/50 text-[10px] font-mono tracking-widest uppercase">
                        <History className="w-3.5 h-3.5 text-[#9d4edd]" />
                        <span>Continue Watching</span>
                      </div>
                      <span className="text-[9px] text-white/30 font-mono">{recentRooms.length} active</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {recentRooms.map((rm) => (
                        <div key={rm.room_id} className="p-3.5 bg-white/5 rounded-xl border border-white/5 hover:border-[#9d4edd]/40 hover:bg-white/[0.08] transition-all flex flex-col justify-between gap-3 text-left">
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0 pr-2">
                              <p className="text-white text-xs font-bold truncate tracking-wide">{rm.room_name || `Room ${rm.room_id}`}</p>
                              <p className="text-[9px] text-[#9d4edd] font-mono uppercase tracking-wider mt-0.5">{rm.room_type || "EPHEMERAL"}</p>
                            </div>
                            <button
                              onClick={() => navigate(`/room/${rm.room_id}?resume=true&time=${rm.last_timestamp || 0}`)}
                              className="px-2.5 py-1.5 bg-[#9d4edd]/25 hover:bg-[#9d4edd] text-[10px] text-white uppercase tracking-wider font-bold rounded-lg transition-all flex items-center gap-1.5 shrink-0 hover:scale-102"
                            >
                              <Play className="w-2.5 h-2.5 fill-current" />
                              <span>Resume</span>
                            </button>
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-mono text-white/45">
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3 h-3" />
                              <span>Frame: {formatTrackTime(rm.last_timestamp)}</span>
                            </div>
                            {rm.scheduled_at ? (
                              <span className="text-purple-300 flex items-center gap-1 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20 text-[9px]">
                                <Calendar className="w-2.5 h-2.5" /> Scheduled
                              </span>
                            ) : (
                              <span className="text-white/20 text-[9px]">ID: {rm.room_id}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {view === "create" && (
              <motion.form key="create" onSubmit={handleCreateRoom} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-5">
                <button type="button" onClick={() => setView("actions")} className="flex items-center gap-2 text-[#9d4edd] text-[10px] font-bold uppercase tracking-widest hover:text-[#b366ff] transition-colors mb-2"><ArrowLeft className="w-3 h-3" /> Back</button>
                
                <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] ml-1">Universal Stream Link</label>
                    <input 
                      type="text" 
                      placeholder="YOUTUBE OR GOOGLE DRIVE URL" 
                      required
                      className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-xs text-white" 
                      value={youtubeUrl} 
                      onChange={(e) => setYoutubeUrl(e.target.value)} 
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] ml-1">Room Display Name</label>
                    <input 
                      type="text" 
                      placeholder="BLINDING ACTION SHOW" 
                      className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-xs text-white" 
                      value={roomName} 
                      onChange={(e) => setRoomName(e.target.value)} 
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setRoomType("EPHEMERAL")} className={`p-4 rounded-xl border text-left flex flex-col justify-between min-h-[75px] transition-all ${roomType === "EPHEMERAL" ? "border-[#9d4edd] bg-[#9d4edd]/10" : "border-white/5 bg-white/5 text-white/40 hover:text-white"}`}>
                      <span className="text-xs font-bold uppercase tracking-wider text-white">Ephemeral</span>
                      <span className="text-[8px] text-white/50 leading-relaxed font-sans">Self-deletes after inactivity</span>
                    </button>
                    <button type="button" onClick={() => setRoomType("PERMANENT")} className={`p-4 rounded-xl border text-left flex flex-col justify-between min-h-[75px] transition-all ${roomType === "PERMANENT" ? "border-purple-400 bg-purple-400/10" : "border-white/5 bg-white/5 text-white/40 hover:text-white"}`}>
                      <span className="text-xs font-bold uppercase tracking-wider text-white">Permanent</span>
                      <span className="text-[8px] text-white/50 leading-relaxed font-sans">Saved forever, non-expiring</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em] ml-1">Schedule Watch Party (Optional)</label>
                    <input 
                      type="datetime-local" 
                      className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-xs text-white font-mono" 
                      value={scheduledAt} 
                      onChange={(e) => setScheduledAt(e.target.value)} 
                    />
                  </div>

                  <div className="space-y-3.5 border-t border-white/5 pt-4">
                    <label className="flex items-center justify-between cursor-pointer p-1">
                      <div className="flex flex-col pr-3">
                        <span className="text-xs font-bold text-white/80">Lobby Waiting Room</span>
                        <span className="text-[9px] text-white/40">Guests wait for hosts authorization first</span>
                      </div>
                      <input type="checkbox" checked={isLobbyEnabled} onChange={(e) => setIsLobbyEnabled(e.target.checked)} className="w-4.5 h-4.5 rounded text-[#9d4edd] ring-offset-[#050505] bg-white/5 border-white/10" />
                    </label>

                    <label className="flex items-center justify-between cursor-pointer p-1">
                      <div className="flex flex-col pr-3">
                        <span className="text-xs font-bold text-white/80">Host-Only Control Lock</span>
                        <span className="text-[9px] text-white/40">Restrict playback (play, pause, scrub) to author</span>
                      </div>
                      <input type="checkbox" checked={onlyHostSync} onChange={(e) => setOnlyHostSync(e.target.checked)} className="w-4.5 h-4.5 rounded text-[#9d4edd] ring-offset-[#050505] bg-white/5 border-white/10" />
                    </label>
                  </div>
                </div>

                <button type="submit" disabled={isLoading || !youtubeUrl} className="w-full flex items-center justify-center gap-2 py-4 bg-[#9d4edd] hover:bg-[#8a3ec9] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-[0.3em] rounded-xl transition-all shadow-glow">
                  {isLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <span>Initialize Broadcast</span>}
                </button>
              </motion.form>
            )}

            {view === "join" && (
              <motion.form key="join" onSubmit={handleJoinRoom} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <button type="button" onClick={() => setView("actions")} className="flex items-center gap-2 text-[#9d4edd] text-[10px] font-bold uppercase tracking-widest hover:text-[#b366ff] transition-colors mb-4"><ArrowLeft className="w-3 h-3" /> Back</button>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] ml-1">Entry Point</label>
                  <input type="text" placeholder="ROOM CODE" className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-purple-400/50 transition-all font-mono tracking-[0.3em] uppercase text-sm text-center text-white" value={joinRoomId} onChange={(e) => setJoinRoomId(e.target.value)} />
                </div>
                <button type="submit" disabled={!joinRoomId} className="w-full py-4 bg-[#9d4edd] hover:bg-[#8b3fdc] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-[0.3em] rounded-xl transition-all">
                  Join Session
                </button>
              </motion.form>
            )}

            {view === "schedule_success" && (
              <motion.div key="schedule_success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-5 text-center">
                <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mx-auto text-green-400">
                  <Check className="w-6 h-6 animate-bounce" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-white uppercase tracking-widest">Party Scheduled!</h3>
                  <p className="text-xs text-white/55">Google Calendar invite generated for this watch session.</p>
                </div>

                <div className="p-3.5 bg-white/5 border border-white/10 rounded-xl relative">
                  <div className="text-[11px] text-[#bf8bff] font-mono break-all font-semibold pr-8 select-all text-left">
                    {`${window.location.origin}/room/${createdRoomId}`}
                  </div>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/room/${createdRoomId}`);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="absolute right-2 top-1.5 p-1.5 text-white/40 hover:text-white transition-colors"
                    title="Copy to clipboard"
                  >
                    {copiedLink ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>

                <div className="space-y-2">
                  <a 
                    href={getGoogleCalendarUrl(createdRoomId)} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs uppercase tracking-[0.2em] rounded-xl transition-all"
                  >
                    <Calendar className="w-4 h-4" />
                    <span>Google Calendar Event</span>
                  </a>
                  <button 
                    onClick={() => navigate(`/room/${createdRoomId}`)} 
                    className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-[0.2em] rounded-xl transition-all border border-white/5"
                  >
                    <span>Enter Room Now</span>
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        <footer className="text-center space-y-2">
          <p className="text-white/20 text-[10px] uppercase font-bold tracking-[0.2em]">
            Optimized for Cinema. No Latency.
          </p>
          <p className="text-white/40 text-[10px] uppercase font-bold tracking-[0.2em]">
            Built by Golu
          </p>
        </footer>
      </div>
    </div>
  );
}

