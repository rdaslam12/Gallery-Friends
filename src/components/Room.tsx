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
  const [isChatTemporarilyVisible, setIsChatTemporarilyVisible] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [ytApiReady, setYtApiReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resolvedDriveUrl, setResolvedDriveUrl] = useState<string | null>(null);

  const [showNextPrompt, setShowNextPrompt] = useState(false);
  const [nextVideoUrl, setNextVideoUrl] = useState("");
  const [isUserActive, setIsUserActive] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  const playerRef = useRef<any>(null);
  const html5VideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef(messages.length);
  const isScrolledUp = useRef(false);
  const tempChatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const initializationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isDrive = roomStatus?.videoId?.startsWith("drive:");
  const actualVideoId = roomStatus?.videoId?.replace(/^(yt:|drive:)/, "") || roomStatus?.videoId;

  const getUnifiedPlayer = () => ({
    getCurrentTime: () => {
      if (isDrive && html5VideoRef.current) return html5VideoRef.current.currentTime;
      if (!isDrive && playerRef.current?.getCurrentTime) return playerRef.current.getCurrentTime();
      return 0;
    },
    getPlayerState: () => {
      if (isDrive && html5VideoRef.current) return html5VideoRef.current.paused ? 2 : 1;
      if (!isDrive && playerRef.current?.getPlayerState) return playerRef.current.getPlayerState();
      return -1;
    },
    pauseVideo: () => {
      if (isDrive && html5VideoRef.current) html5VideoRef.current.pause();
      if (!isDrive && playerRef.current?.pauseVideo) playerRef.current.pauseVideo();
    },
    playVideo: () => {
      if (isDrive && html5VideoRef.current) html5VideoRef.current.play().catch(e => console.error("Play error", e));
      if (!isDrive && playerRef.current?.playVideo) playerRef.current.playVideo();
    },
    seekTo: (time: number, allowSeekAhead: boolean) => {
      if (isDrive && html5VideoRef.current) html5VideoRef.current.currentTime = time;
      if (!isDrive && playerRef.current?.seekTo) playerRef.current.seekTo(time, allowSeekAhead);
    }
  });

  // Autoscroll chat and temporary chat visibility
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      if (!isChatVisible) {
         setIsChatTemporarilyVisible(true);
         if (tempChatTimeoutRef.current) clearTimeout(tempChatTimeoutRef.current);
         tempChatTimeoutRef.current = setTimeout(() => {
           setIsChatTemporarilyVisible(false);
         }, 3000);
      }
      if (!isScrolledUp.current) {
         chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
    prevMessagesLength.current = messages.length;
  }, [messages, isChatVisible]);

  const handleChatScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      // Scrolled up if distance from bottom is greater than 50px
      isScrolledUp.current = Math.ceil(scrollTop + clientHeight) < scrollHeight - 50;
    }
  };

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
    if (!roomStatus) return;

    if (isDrive && actualVideoId) {
      setResolvedDriveUrl(`/api/proxy-video/${actualVideoId}`);
      setIsPlayerReady(true);
      return;
    }

    if (ytApiReady) {
      if (!playerRef.current) {
        try {
          playerRef.current = new window.YT.Player("youtube-player", {
            videoId: actualVideoId,
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
                setLoadError(`YouTube Player Error: ${e.data}`);
              }
            },
          });

          initializationTimeoutRef.current = setTimeout(() => {
            if (!isPlayerReady) setIsPlayerReady(true);
          }, 8000);

        } catch (err: any) {
          setLoadError(`Failed to init YouTube: ${err?.message || err}`);
        }
      } else if (playerRef.current && typeof playerRef.current.getVideoData === "function") {
         const currentVideoData = playerRef.current.getVideoData();
         if (currentVideoData && currentVideoData.video_id !== actualVideoId) {
           playerRef.current.loadVideoById(actualVideoId);
           setShowNextPrompt(false);
         }
      }
    }
    return () => {
      if (initializationTimeoutRef.current) clearTimeout(initializationTimeoutRef.current);
    };
  }, [ytApiReady, roomStatus, isDrive, actualVideoId]);

  // Main Polling Loop
  useEffect(() => {
    if (!isPlayerReady || !roomId) return;

    pollingIntervalRef.current = setInterval(async () => {
      const unifiedPlayer = getUnifiedPlayer();
    
      if (isHost) {
        const currentTime = unifiedPlayer.getCurrentTime();
        const playerState = unifiedPlayer.getPlayerState();
        const isPaused = playerState === 2 || playerState === -1;

        try {
          await fetch(`/api/room/${roomId}/update`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              currentTimestamp: currentTime,
              isPaused: isPaused,
              sessionId: sessionId,
              videoId: roomStatus?.videoId,
            }),
          });
        } catch (e) {}
      } else {
        try {
          const response = await fetch(`/api/room/${roomId}/status`);
          if (response.ok) {
            const status: RoomStatus = await response.json();
            setRoomStatus(status);

            const localTime = unifiedPlayer.getCurrentTime();
            const timeDiff = Math.abs(localTime - status.currentTimestamp);

            const playerState = unifiedPlayer.getPlayerState();
            if (status.isPaused && playerState === 1) {
              unifiedPlayer.pauseVideo();
            } else if (!status.isPaused && (playerState === 2 || playerState === -1)) {
              unifiedPlayer.playVideo();
            }

            if (timeDiff > 2.0) {
              unifiedPlayer.seekTo(status.currentTimestamp, true);
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
  }, [isPlayerReady, isHost, roomId, sessionId, isDrive]);

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
        setNextVideoUrl("");
        setShowNextPrompt(false);
      } else {
        alert("Failed to change video");
      }
    } catch (error) {
       alert("Error changing video");
    }
  };

  const uiOpacityClass = isUserActive ? "opacity-100" : "opacity-0 pointer-events-none";

  return (
    <div className="w-screen h-screen flex flex-col md:flex-row bg-[#050505] font-sans overflow-hidden">
      
      {/* Video Block (Flex Item) */}
      <div className="flex-1 relative flex items-center justify-center bg-black min-h-0 min-w-0">
        
        {/* The YouTube or Drive Player */}
        <div id="youtube-player" className={`w-full h-full pointer-events-auto ${isDrive ? "hidden" : ""}`} />
        
        {isDrive && resolvedDriveUrl && (
          <video
            ref={html5VideoRef}
            src={resolvedDriveUrl}
            className="absolute inset-0 w-full h-full object-contain pointer-events-auto z-0"
            controls
            autoPlay
            onPlay={() => {
              setIsPlaying(true);
              if (isHost) setShowNextPrompt(false);
            }}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setShowNextPrompt(true);
              if (isHost) setIsUserActive(true);
            }}
            onError={(e) => setLoadError("Failed to load Google Drive video. Ensure link is public.")}
          />
        )}

        {/* Cinematic gradient (over video) */}
        <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/60 z-10 pointer-events-none transition-opacity duration-500 ${isUserActive ? "opacity-100" : "opacity-0"}`} />

        {/* Top Header Region (Overlay inside video) */}
        <div className={`absolute top-0 left-0 right-0 z-20 p-4 md:p-8 flex justify-between items-start pointer-events-none transition-opacity duration-500 ${uiOpacityClass}`}>
           <div className="flex items-center gap-3 pointer-events-auto">
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

           <div className="flex items-center gap-2 pointer-events-auto">
             <button
                onClick={() => {
                  navigator.clipboard.writeText(roomId || "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/10 rounded-full text-xs text-white font-bold uppercase tracking-widest transition-all"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{roomId}</span>
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

        {/* Play Next Prompt */}
        <AnimatePresence>
          {showNextPrompt && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl w-[90%] max-w-md pointer-events-auto z-40 transition-opacity duration-300"
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

        {/* Float Right Side Chat Toggle (When closed) */}
        {(!isChatVisible && !isChatTemporarilyVisible) && (
           <div className={`absolute bottom-6 right-6 md:bottom-auto md:top-24 md:right-6 pointer-events-auto z-40 transition-opacity duration-500 ${uiOpacityClass}`}>
             <button
                onClick={() => {
                  setIsChatVisible(true);
                  if (tempChatTimeoutRef.current) clearTimeout(tempChatTimeoutRef.current);
                  setIsChatTemporarilyVisible(false);
                }}
                className="w-12 h-12 rounded-full bg-black/40 hover:bg-black/60 shadow-[0_0_15px_rgba(157,78,221,0.2)] backdrop-blur-md border border-white/10 text-white flex items-center justify-center transition-all"
                title="Open Chat"
              >
                <MessageSquare className="w-5 h-5" />
              </button>
           </div>
        )}
      </div>

      {/* Chat Area (Right Side or Bottom) */}
      <AnimatePresence initial={false}>
        {(isChatVisible || isChatTemporarilyVisible) && (
          <motion.div 
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`h-[40vh] md:h-full md:w-[350px] w-full bg-[#0d0d0d] border-t md:border-t-0 md:border-l border-white/5 flex flex-col shrink-0 overflow-hidden ${isChatTemporarilyVisible && !isChatVisible ? 'fixed right-0 bottom-0 md:top-0 z-[100]' : 'relative z-[60]'} shadow-2xl`}
          >
            {/* Chat Head */}
            <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0 pointer-events-auto">
               <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live Chat
               </span>
               <button
                  onClick={() => {
                    setIsChatVisible(false);
                    setIsChatTemporarilyVisible(false);
                  }}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
               >
                 <ArrowRight className="w-4 h-4 md:hidden rotate-90" />
                 <ArrowRight className="w-4 h-4 hidden md:block" />
               </button>
            </div>

            {/* Messages */}
            <div 
              ref={chatContainerRef}
              onScroll={handleChatScroll}
              className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar pointer-events-auto"
            >
               {messages.map((msg) => (
                  <div key={msg.id} className="flex flex-col gap-1 w-full max-w-[90%]">
                    <span className="text-[10px] text-white/40 uppercase font-bold tracking-wider ml-1">
                      {msg.username}
                    </span>
                    <div className={`px-4 py-2.5 text-sm leading-relaxed text-white/90 ${msg.username === username ? "bg-[#9d4edd]/20 border border-[#9d4edd]/50 rounded-2xl rounded-tr-sm ml-auto" : "bg-white/5 border border-white/5 rounded-2xl rounded-tl-sm mr-auto"}`}>
                       {msg.message_text}
                    </div>
                  </div>
               ))}
               <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={handleSendMessage} className="p-4 bg-black/40 border-t border-white/5 shrink-0 relative">
              <input
                type="text"
                className="w-full pl-4 pr-12 py-3 bg-white/10 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-sm text-white"
                placeholder="Message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
              />
              <button
                type="submit"
                disabled={!newMessage.trim()}
                className="absolute right-6 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#9d4edd] hover:bg-[#833bc2] rounded-md flex items-center justify-center disabled:opacity-50 transition-colors text-white"
              >
                <ArrowRight className="w-4 h-4 -rotate-45" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

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
