import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Plus, Zap, User, Lock, Mail, ArrowLeft, LogIn } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type LandingState = "initial" | "login" | "guest" | "actions" | "create" | "join";

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
  
  const navigate = useNavigate();

  useEffect(() => {
     if (username) {
         setView("actions");
     }
  }, [username]);

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
        body: JSON.stringify({ videoUrl: youtubeUrl, hostSessionId: sessionId }),
      });

      if (response.ok) {
        const { roomId } = await response.json();
        navigate(`/room/${roomId}`);
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
    navigate(`/room/${joinRoomId}`);
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
               <div className="text-center mb-6">
                 <p className="text-white/40 text-[10px] font-mono tracking-widest uppercase">Welcome, <span className="text-white font-bold">{username}</span></p>
               </div>
               <button onClick={() => setView("create")} className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-[#9d4edd] hover:bg-[#8a3ec9] text-white font-bold text-xs uppercase tracking-[0.3em] rounded-xl transition-all shadow-glow">
                 <Plus className="w-4 h-4" />
                 <span>Create Room</span>
               </button>
               <button onClick={() => setView("join")} className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white/5 hover:bg-white/10 text-white font-bold text-xs uppercase tracking-[0.3em] rounded-xl transition-all border border-white/5">
                 <Play className="w-4 h-4 fill-current" />
                 <span>Join Room</span>
               </button>
             </motion.div>
            )}

            {view === "create" && (
              <motion.form key="create" onSubmit={handleCreateRoom} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <button type="button" onClick={() => setView("actions")} className="flex items-center gap-2 text-[#9d4edd] text-[10px] font-bold uppercase tracking-widest hover:text-[#b366ff] transition-colors mb-4"><ArrowLeft className="w-3 h-3" /> Back</button>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] ml-1">Source Material</label>
                  <input type="text" placeholder="YOUTUBE OR GOOGLE DRIVE URL" className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-sm text-white" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} />
                </div>
                <button type="submit" disabled={isLoading || !youtubeUrl} className="w-full flex items-center justify-center gap-2 py-4 bg-[#9d4edd] hover:bg-[#8a3ec9] disabled:opacity-50 text-white font-bold text-xs uppercase tracking-[0.3em] rounded-xl transition-all shadow-glow">
                  {isLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <span>Start Broadcast</span>}
                </button>
              </motion.form>
            )}

            {view === "join" && (
              <motion.form key="join" onSubmit={handleJoinRoom} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-6">
                <button type="button" onClick={() => setView("actions")} className="flex items-center gap-2 text-[#9d4edd] text-[10px] font-bold uppercase tracking-widest hover:text-[#b366ff] transition-colors mb-4"><ArrowLeft className="w-3 h-3" /> Back</button>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] ml-1">Entry Point</label>
                  <input type="text" placeholder="ROOM CODE" className="w-full px-5 py-4 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-cyan-400/50 transition-all font-mono tracking-[0.3em] uppercase text-sm text-center text-white" value={joinRoomId} onChange={(e) => setJoinRoomId(e.target.value)} />
                </div>
                <button type="submit" disabled={!joinRoomId} className="w-full py-4 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-[0.3em] rounded-xl transition-all">
                  Join Session
                </button>
              </motion.form>
            )}

          </AnimatePresence>
        </div>

        <footer className="text-center">
          <p className="text-white/20 text-[10px] uppercase font-bold tracking-[0.3em]">
            Optimized for Cinema. No Latency.
          </p>
        </footer>
      </div>
    </div>
  );
}

