import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Copy, Check, MessageSquare, Zap, LogOut, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { RoomStatus, ChatMessage } from "../types";

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const [username, setUsername] = useState(localStorage.getItem("syncStream_username") || "");
  const [sessionId] = useState(localStorage.getItem("syncStream_sessionId") || Math.random().toString(36).substring(2, 15));
  
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [isHost, setIsHost] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [ytApiReady, setYtApiReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [showNextPrompt, setShowNextPrompt] = useState(false);
  const [nextVideoUrl, setNextVideoUrl] = useState("");
  const [isUserActive, setIsUserActive] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  const playerRef = useRef<any>(null);
  const currentVideoIdRef = useRef<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const initializationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize display name if missing
  useEffect(() => {
    if (!username && roomId) {
      const name = prompt("Please enter your display name:");
      if (name) {
        setUsername(name);
        localStorage.setItem("syncStream_username", name);
      } else {
        navigate("/");
      }
    }
  }, [username, navigate, roomId]);

  // Handle User Activity for Auto-Hide UI
  useEffect(() => {
    const handleActivity = () => {
      setIsUserActive(true);
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
      
      if (isPlaying) {
        activityTimeoutRef.current = setTimeout(() => {
          setIsUserActive(false);
        }, 3000);
      }
    };

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    handleActivity();

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    };
  }, [isPlaying]);

  // Load YouTube API
  useEffect(() => {
    if (window.YT && typeof window.YT.Player === "function") {
      setYtApiReady(true);
      return;
    }

    window.onYouTubeIframeAPIReady = () => {
      setYtApiReady(true);
    };

    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    const interval = setInterval(() => {
      if (window.YT && typeof window.YT.Player === "function") {
        setYtApiReady(true);
        clearInterval(interval);
      }
    }, 500);

    return () => clearInterval(interval);
  }, []);

  // Fetch initial room status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/room/${roomId}/status`);
        if (response.ok) {
          const status: RoomStatus = await response.json();
          setRoomStatus(status);
          setIsHost(status.hostSessionId === sessionId);
        } else {
          setLoadError("Room not found or internal server error");
          setTimeout(() => navigate("/"), 3000);
        }
      } catch (error) {
        setLoadError("Failed to connect to sync server");
      }
    };

    if (roomId) fetchStatus();
  }, [roomId, sessionId, navigate]);

  // Initialize player
  useEffect(() => {
    if (ytApiReady && roomStatus) {
      if (!playerRef.current) {
        try {
          playerRef.current = new window.YT.Player("youtube-player", {
            videoId: roomStatus.videoId,
            playerVars: {
              autoplay: 1,
              controls: 1,
              rel: 0,
              modestbranding: 1,
              origin: window.location.origin,
              enablejsapi: 1
            },
            events: {
              onReady: () => {
                currentVideoIdRef.current = roomStatus.videoId;
                setIsPlayerReady(true);
                if (initializationTimeoutRef.current) clearTimeout(initializationTimeoutRef.current);
              },
              onStateChange: (event: any) => {
                if (event.data === 1) { // Playing
                  setIsPlaying(true);
                  if (isHost) setShowNextPrompt(false);
                } else if (event.data === 2 || event.data === 0 || event.data === -1) {
                  setIsPlaying(false);
                }

                if (event.data === 0) {
                  setShowNextPrompt(true);
                  if (isHost) setIsUserActive(true);
                } else if (event.data === 1 && isHost) {
                  setShowNextPrompt(false);
                }
              },
              onError: (e: any) => {
                console.error(`YouTube Player Error: ${e.data}`);
                if (isHost) {
                  setShowNextPrompt(true);
                  setIsUserActive(true);
                }
              }
            },
          });

          initializationTimeoutRef.current = setTimeout(() => {
            if (!isPlayerReady) setIsPlayerReady(true);
          }, 8000);

        } catch (err) {
          setLoadError("Failed to initialize player component");
        }
      } else if (playerRef.current && typeof playerRef.current.getVideoData === "function") {
         const currentVideoData = playerRef.current.getVideoData();
         if (currentVideoData && currentVideoData.video_id !== roomStatus.videoId) {
           playerRef.current.loadVideoById(roomStatus.videoId);
           setShowNextPrompt(false);
         }
      }
    }
    return () => {
      if (initializationTimeoutRef.current) clearTimeout(initializationTimeoutRef.current);
    };
  }, [ytApiReady, roomStatus]);

  // Main Polling Loop
  useEffect(() => {
    if (!isPlayerReady || !roomId) return;

    pollingIntervalRef.current = setInterval(async () => {
      if (isHost) {
        const currentTime = playerRef.current.getCurrentTime();
        const playerState = playerRef.current.getPlayerState();
        const isPaused = playerState === 2 || playerState === -1;

        try {
          await fetch(`/api/room/${roomId}/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currentTimestamp: currentTime,
              isPaused: isPaused,
              sessionId: sessionId,
              videoId: playerRef.current?.getVideoData?.()?.video_id || roomStatus?.videoId,
            }),
          });
        } catch (e) {}
      } else {
        try {
          const response = await fetch(`/api/room/${roomId}/status`);
          if (response.ok) {
            const status: RoomStatus = await response.json();
            setRoomStatus(status);

            if (currentVideoIdRef.current !== status.videoId) {
                 playerRef.current.loadVideoById(status.videoId);
                 currentVideoIdRef.current = status.videoId;
                 setShowNextPrompt(false);
            }

            const localTime = playerRef.current.getCurrentTime();
            const timeDiff = Math.abs(localTime - status.currentTimestamp);

            const playerState = playerRef.current.getPlayerState();
            if (status.isPaused && playerState === 1) {
              playerRef.current.pauseVideo();
            } else if (!status.isPaused && (playerState === 2 || playerState === -1 || playerState === 0 || playerState === 5)) {
              playerRef.current.playVideo();
            }

            if (timeDiff > 2.0 && !status.isPaused && playerState !== 3) {
              playerRef.current.seekTo(status.currentTimestamp, true);
            }
          }
        } catch (e) {}
      }

      try {
        const msgResponse = await fetch(`/api/room/${roomId}/messages`);
        if (msgResponse.ok) {
          const newMessages = await msgResponse.json();
          setMessages(newMessages);
        }
      } catch (e) {}
    }, 1500);

    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, [isPlayerReady, isHost, roomId, sessionId]);

  // Autoscroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !username) return;

    try {
      await fetch(`/api/room/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username,
          messageText: newMessage,
        }),
      });
      setNewMessage("");
    } catch (e) {}
  };

  const handleNextVideoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nextVideoUrl || !isHost) return;

    try {
      const response = await fetch(`/api/room/${roomId}/change-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: nextVideoUrl, sessionId }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setNextVideoUrl("");
        setShowNextPrompt(false);
        if (data.videoId) {
          setRoomStatus(prev => prev ? { ...prev, videoId: data.videoId, isPaused: 1, currentTimestamp: 0 } : null);
          if (playerRef.current && typeof playerRef.current.loadVideoById === "function") {
            playerRef.current.loadVideoById(data.videoId);
          }
        }
      } else {
        alert("Failed to change video");
      }
    } catch (error) {
       alert("Error changing video");
    }
  };

  const uiOpacityClass = isUserActive ? "opacity-100" : "opacity-0 pointer-events-none";

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#050505] font-sans">
      {/* YouTube Player Background */}
      <div className="absolute inset-0 z-0">
        <div id="youtube-player" className="w-full h-full pointer-events-auto" />
      </div>

      {/* Cinematic Overlays */}
      <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/60 z-10 pointer-events-none transition-opacity duration-500 ${isUserActive ? "opacity-100" : "opacity-0"}`} />

      {/* UI Overlay Wrapper */}
      <div className={`absolute inset-0 z-30 pointer-events-none p-4 md:p-8 flex flex-col justify-between transition-opacity duration-500 ${uiOpacityClass}`}>
        
        {/* Top Header Region */}
        <div className="flex justify-between items-start pointer-events-auto">
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-2xl">
                <Zap className="w-5 h-5 text-[#9d4edd] fill-current" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md">Gallery Friends</h1>
                <div className="flex items-center gap-2 text-[10px] text-white/80 uppercase tracking-widest font-mono drop-shadow-md">
                  {isHost ? <span className="text-[#9d4edd] font-bold">Host</span> : <span>Guest</span>}
                  <span>•</span>
                  <span>{username}</span>
                </div>
              </div>
           </div>

           <div className="flex items-center gap-2">
             <button
                onClick={() => {
                  navigator.clipboard.writeText(roomId || "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/10 rounded-full text-xs text-white font-bold uppercase tracking-widest transition-all"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                <span>{roomId}</span>
              </button>
              <button 
                onClick={() => navigate("/")}
                className="w-10 h-10 rounded-full bg-red-500/20 text-red-500 hover:bg-red-500/40 backdrop-blur-md border border-red-500/20 flex items-center justify-center transition-colors"
                title="Quit Session"
              >
                <LogOut className="w-4 h-4" />
              </button>
           </div>
        </div>

        {/* Bottom Region */}
        <div className="flex justify-between items-end gap-6 relative h-[60%]">
            
            {/* Play Next / Video End Prompt Overlay */}
            <AnimatePresence>
              {showNextPrompt && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl w-full max-w-md pointer-events-auto z-40 transition-opacity duration-300"
                >
                   <div className="text-center mb-6">
                      <h3 className="text-xl font-bold mb-2 text-white">Video Ended</h3>
                      {!isHost && <p className="text-white/50 text-sm">Waiting for the host to select the next video.</p>}
                   </div>
                   
                   {isHost && (
                     <form onSubmit={handleNextVideoSubmit} className="space-y-4">
                       <input 
                         type="text" 
                         placeholder="Paste next YouTube URL..."
                         className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/10 text-sm text-white focus:border-[#9d4edd] outline-none transition-colors"
                         value={nextVideoUrl}
                         onChange={(e) => setNextVideoUrl(e.target.value)}
                       />
                       <button 
                         type="submit"
                         disabled={!nextVideoUrl}
                         className="w-full py-3 bg-[#9d4edd] hover:bg-[#833bc2] rounded-xl font-bold text-white uppercase tracking-widest text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                       >
                         <ArrowRight className="w-4 h-4"/> Play Next
                       </button>
                     </form>
                   )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Chat Area - Transparent Bubble Style */}
            <AnimatePresence>
              {isChatVisible && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="w-full max-w-md flex flex-col gap-4 pointer-events-auto h-full"
                >
                  <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar flex flex-col justify-end pb-2 [mask-image:linear-gradient(to_top,black_85%,transparent)]">
                     {messages.map((msg) => (
                        <div key={msg.id} className="flex flex-col gap-1 w-fit max-w-[85%]">
                          <span className="text-[10px] text-white/70 uppercase font-bold tracking-wider ml-3 drop-shadow-md">
                            {msg.username}
                          </span>
                          <div className={`px-4 py-2.5 rounded-[20px] text-sm leading-relaxed backdrop-blur-md shadow-lg text-white/90 ${msg.username === username ? "bg-[#9d4edd]/80 rounded-bl-sm" : "bg-black/40 border border-white/10 rounded-tl-sm"}`}>
                             {msg.message_text}
                          </div>
                        </div>
                     ))}
                     <div ref={chatEndRef} />
                  </div>
                  
                  <form onSubmit={handleSendMessage} className="relative">
                    <input
                      type="text"
                      className="w-full pl-5 pr-12 py-4 bg-black/40 backdrop-blur-xl border border-white/10 rounded-full outline-none focus:border-[#9d4edd]/50 transition-all text-sm text-white shadow-xl"
                      placeholder="Comment..."
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={!newMessage.trim()}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-10 h-10 bg-[#9d4edd] hover:bg-[#8a3ec9] rounded-full flex items-center justify-center disabled:opacity-50 transition-colors shadow-glow text-white"
                    >
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Right Side Control (Toggle Chat) */}
            <div className="flex items-end gap-3 pointer-events-auto justify-end">
                <button
                  onClick={() => setIsChatVisible(!isChatVisible)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all backdrop-blur-xl border shadow-xl ${
                    isChatVisible ? "bg-white/20 border-white/20 text-white" : "bg-black/40 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                  }`}
                  title="Toggle Chat"
                >
                  <MessageSquare className="w-5 h-5" />
                </button>
            </div>
            
        </div>
      </div>

      {/* Loading Overlay */}
      {(!isPlayerReady || loadError) && (
        <div className="absolute inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center text-white px-6">
          {loadError ? (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }} 
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/50">
                <span className="text-red-500 text-2xl font-bold">!</span>
              </div>
              <h2 className="text-xl font-bold tracking-tight uppercase mb-2">Sync Error</h2>
              <p className="text-white/40 text-sm mb-8 max-w-xs mx-auto">{loadError}</p>
              <button 
                onClick={() => navigate("/")}
                className="px-6 py-3 bg-white/10 hover:bg-white/20 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
              >
                Return to Landing
              </button>
            </motion.div>
          ) : (
            <>
              <div className="relative mb-12">
                <div className="w-20 h-20 border-[2px] border-white/5 border-t-[#9d4edd] rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-[#9d4edd] fill-current animate-pulse" />
                </div>
              </div>
              <div className="text-center space-y-4">
                <h2 className="text-sm font-bold tracking-[0.5em] text-white uppercase animate-pulse">Initializing Session</h2>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
