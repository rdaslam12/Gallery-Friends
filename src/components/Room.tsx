import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Copy, Check, MessageSquare, Zap, LogOut, ArrowRight, ArrowDown, Layout, X, Maximize, Minimize, Subtitles } from "lucide-react";
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
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [isChatTemporarilyVisible, setIsChatTemporarilyVisible] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [ytApiReady, setYtApiReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isChatOverlayMode, setIsChatOverlayMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resolvedDriveUrl, setResolvedDriveUrl] = useState<string | null>(null);
  const [activeReactions, setActiveReactions] = useState<{id: number, emoji: string, startX: number}[]>([]);

  const [showNextPrompt, setShowNextPrompt] = useState(false);
  const [nextVideoUrl, setNextVideoUrl] = useState("");
  const [isUserActive, setIsUserActive] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(document.fullscreenElement !== null);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [driveSubtitleTracks, setDriveSubtitleTracks] = useState<{ lang: string; name: string; label: string }[]>([]);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);

  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isTypingRef.current = isTyping;
  }, [isTyping]);

  const playerRef = useRef<any>(null);
  const html5VideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const playedReactionsRef = useRef<Set<number>>(new Set());
  const prevMessagesLength = useRef(messages.length);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
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
      const newMessages = messages.slice(prevMessagesLength.current);
      
      // Floating reactions
      const newReactions = newMessages.filter(m => m.message_text?.startsWith("[EMOJI]:") && !playedReactionsRef.current.has(m.id));
      if (newReactions.length > 0) {
         newReactions.forEach(r => playedReactionsRef.current.add(r.id));
         const spawns = newReactions.flatMap(m => {
            const emoji = m.message_text.replace("[EMOJI]:", "");
            return Array.from({length: 8}).map(() => ({
              id: Math.random(),
              emoji,
              startX: Math.random() * 80 - 40,
            }));
         });
         setActiveReactions(prev => [...prev, ...spawns]);
         setTimeout(() => {
            setActiveReactions(prev => prev.filter(r => !spawns.some(s => s.id === r.id)));
         }, 1500);
      }

      const hasStandardMessages = newMessages.some(m => !m.message_text?.startsWith("[EMOJI]:"));
      if (hasStandardMessages) {
        if (!isChatVisible || isEffectiveChatOverlayMode) {
           setIsChatTemporarilyVisible(true);
           if (tempChatTimeoutRef.current) clearTimeout(tempChatTimeoutRef.current);
           tempChatTimeoutRef.current = setTimeout(() => {
             setIsChatTemporarilyVisible(false);
           }, 2500); // Wait 2.5s before disappearing
        }
        if (!isScrolledUp) {
           chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }
    }
    prevMessagesLength.current = messages.length;
  }, [messages, isChatVisible, isScrolledUp]);

  const handleChatScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
      // Scrolled up if distance from bottom is greater than 50px
      const scrolled = Math.ceil(scrollTop + clientHeight) < scrollHeight - 50;
      setIsScrolledUp(scrolled);
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

  // Clean presence on browser closed, tab unloaded or route navigated away
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (roomId && sessionId) {
        navigator.sendBeacon(
          `/api/room/${roomId}/leave`,
          JSON.stringify({ sessionId })
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (roomId && sessionId) {
        fetch(`/api/room/${roomId}/leave`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId })
        }).catch(() => {});
      }
    };
  }, [roomId, sessionId]);

  // Handle User Activity for Auto-Hide UI
  useEffect(() => {
    const handleActivity = () => {
      setIsUserActive(true);
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
      
      if (isPlaying) {
        activityTimeoutRef.current = setTimeout(() => {
          setIsUserActive(false);
        }, 2000);
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

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const handleSubtitleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      let text = event.target?.result as string;
      
      if (file.name.endsWith('.srt')) {
        text = 'WEBVTT\n\n' + text.replace(/\{\\([ib])\}/g, '<$1>')
                  .replace(/\{\\\/([ib])\}/g, '</$1>')
                  .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
                  .replace(/\r\n/g, '\n');
      }
      
      const blob = new Blob([text], { type: 'text/vtt' });
      const url = URL.createObjectURL(blob);
      setSubtitleUrl(url);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

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
              enablejsapi: 1,
              fs: 0
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
      } else if (playerRef.current) {
        let currentVideoId = "";
        if (typeof playerRef.current.getVideoData === "function") {
          const currentVideoData = playerRef.current.getVideoData();
          if (currentVideoData && currentVideoData.video_id) {
            currentVideoId = currentVideoData.video_id;
          }
        }
        if (currentVideoId !== actualVideoId) {
          if (typeof playerRef.current.loadVideoById === "function") {
            playerRef.current.loadVideoById(actualVideoId);
            setShowNextPrompt(false);
          }
        }
      }
    }
    return () => {
      if (initializationTimeoutRef.current) clearTimeout(initializationTimeoutRef.current);
    };
  }, [ytApiReady, roomStatus, isDrive, actualVideoId]);

  // Clear subtitles and trigger video updates when video changes
  useEffect(() => {
    setSubtitleUrl(null);
    setDriveSubtitleTracks([]);
    if (isDrive && actualVideoId) {
      fetch(`/api/drive-subtitles-list/${actualVideoId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.tracks && data.tracks.length > 0) {
            setDriveSubtitleTracks(data.tracks);
            // Auto load English or the first available track
            const defaultTrack = data.tracks.find((t: any) => t.lang.toLowerCase().startsWith("en")) || data.tracks[0];
            if (defaultTrack) {
              const url = `/api/drive-subtitles/${actualVideoId}/${defaultTrack.lang}?name=${encodeURIComponent(defaultTrack.name)}`;
              setSubtitleUrl(url);
            }
          }
        })
        .catch((err) => console.error("Error auto-loading Google Drive subtitle list:", err));
    }
  }, [actualVideoId, isDrive]);

  // Trigger HTML5 video load/play when source changes
  useEffect(() => {
    if (isDrive && html5VideoRef.current && resolvedDriveUrl) {
      html5VideoRef.current.load();
      html5VideoRef.current.play().catch(e => console.log("HTML5 autoplay blocked or waiting", e));
    }
  }, [resolvedDriveUrl, isDrive]);

  // Main Polling Loop
  useEffect(() => {
    if (!isPlayerReady || !roomId) return;

    pollingIntervalRef.current = setInterval(async () => {
      const unifiedPlayer = getUnifiedPlayer();
    
      if (isHost) {
        let shouldSendUpdate = true;
        if (!isDrive && playerRef.current) {
          if (typeof playerRef.current.getVideoData === "function") {
            const currentVideoData = playerRef.current.getVideoData();
            if (!currentVideoData || !currentVideoData.video_id || currentVideoData.video_id !== actualVideoId) {
              shouldSendUpdate = false;
            }
          } else {
            shouldSendUpdate = false;
          }
        }

        if (shouldSendUpdate) {
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
        }
      } else {
        try {
          const response = await fetch(`/api/room/${roomId}/status`);
          if (response.ok) {
            const status: RoomStatus = await response.json();
            setRoomStatus(status);

            let isPlayerVideoMatching = true;
            if (!isDrive && playerRef.current) {
              if (typeof playerRef.current.getVideoData === "function") {
                const currentVideoData = playerRef.current.getVideoData();
                if (!currentVideoData || !currentVideoData.video_id || currentVideoData.video_id !== actualVideoId) {
                  isPlayerVideoMatching = false;
                }
              } else {
                isPlayerVideoMatching = false;
              }
            }

            if (isPlayerVideoMatching) {
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

      if (username) {
        try {
          const hbResponse = await fetch(`/api/room/${roomId}/heartbeat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username,
              sessionId,
              isTyping: isTypingRef.current,
            }),
          });
          if (hbResponse.ok) {
            const hbData = await hbResponse.json();
            if (hbData.success && hbData.typingUsers) {
              setTypingUsers(hbData.typingUsers);
            }
          }
        } catch (e) {}
      }
    }, 1500);

    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, [isPlayerReady, isHost, roomId, sessionId, isDrive, roomStatus?.videoId, actualVideoId, username]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    if (!isTyping) {
      setIsTyping(true);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 2000);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !username) return;

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    setIsTyping(false);

    try {
      await fetch(`/api/room/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username,
          messageText: newMessage,
          replyToId: replyTarget ? replyTarget.id : null,
        }),
      });
      setNewMessage("");
      setReplyTarget(null);
    } catch (e) {}
  };

  const handleSendEmoji = async (emoji: string) => {
    if (!username) return;
    try {
      await fetch(`/api/room/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, messageText: `[EMOJI]:${emoji}` }),
      });
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
        if (data.videoId) {
          setRoomStatus(prev => prev ? {
            ...prev,
            videoId: data.videoId,
            currentTimestamp: 0,
            isPaused: true
          } : {
            videoId: data.videoId,
            currentTimestamp: 0,
            isPaused: true,
            hostSessionId: sessionId
          });
        }
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
  const isEffectiveChatOverlayMode = isFullscreen || isChatOverlayMode;

  return (
    <div className="w-screen h-screen flex flex-col md:flex-row bg-[#050505] font-sans overflow-hidden">
      
      {/* Video Block (Flex Item) */}
      <div className="flex-1 relative flex items-center justify-center bg-[#050505] min-h-0 min-w-0 p-2 md:p-4 md:pt-12 md:pb-12">
        
        {/* The YouTube or Drive Player Wrapper */}
        <div className="relative w-full h-full bg-black rounded-2xl overflow-hidden border border-white/10 shadow-2xl z-0 pointer-events-auto">
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
            >
              {subtitleUrl && <track key={subtitleUrl} kind="subtitles" src={subtitleUrl} srcLang="en" label="Subtitles" default />}
            </video>
          )}
        </div>

        {/* Cinematic gradient (over video) - Removed */}
        

        {/* Top Header Region (Overlay inside video) */}
        <div className={`absolute top-0 left-0 right-0 z-20 p-2 md:p-4 flex justify-between items-start pointer-events-none transition-opacity duration-500 ${uiOpacityClass}`}>
           <div className="flex items-center gap-2 pointer-events-auto">
              <div className="w-6 h-6 rounded-lg bg-black/40 backdrop-blur-md flex items-center justify-center border border-white/10 shadow-2xl">
                <Zap className="w-3 h-3 text-[#9d4edd] fill-current" />
              </div>
              <div>
                <h1 className="text-xs md:text-sm font-bold tracking-tight text-white drop-shadow-md">Gallery Friends</h1>
                <div className="flex items-center gap-1 text-[8px] text-white/80 uppercase tracking-widest font-mono drop-shadow-md leading-[14px]">
                  {isHost ? <span className="text-[#9d4edd] font-bold text-[6px]">Host</span> : <span className="text-[6px]">Guest</span>}
                  <span className="text-[6px]">•</span>
                  <span className="text-[6px]">{username}</span>
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
                className="flex items-center gap-1 px-2 py-1 bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/10 rounded-full text-[10px] text-white font-bold uppercase tracking-widest transition-all"
              >
                {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                <span className="hidden sm:inline">{roomId}</span>
              </button>
              <button 
                onClick={() => navigate("/")}
                className="w-6 h-6 rounded-full bg-red-500/20 text-red-500 hover:bg-red-500/40 backdrop-blur-md border border-red-500/20 flex items-center justify-center transition-colors"
                title="Quit Session"
              >
                <LogOut className="w-3 h-3" />
              </button>
              {isDrive && (
                <div className="relative">
                  <input 
                    type="file" 
                    accept=".srt,.vtt"
                    ref={fileInputRef} 
                    onChange={handleSubtitleUpload}
                    className="hidden" 
                  />
                  <button
                    onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
                    className={`w-6 h-6 rounded-full hover:scale-105 active:scale-95 transition-all ${subtitleUrl ? 'bg-[#9d4edd]/50 text-white border-[#9d4edd]' : 'bg-white/10 text-white hover:bg-white/20 border-white/10'} backdrop-blur-md border flex items-center justify-center transition-colors`}
                    title="Subtitle Settings"
                  >
                    <Subtitles className="w-3 h-3" />
                  </button>

                  <AnimatePresence>
                    {showSubtitleMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-2 w-56 bg-black/95 backdrop-blur-xl border border-white/10 rounded-xl p-3 shadow-2xl z-50 text-xs text-white"
                      >
                        <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 font-semibold">
                          <span>Subtitles</span>
                          <button 
                            onClick={() => setShowSubtitleMenu(false)}
                            className="text-white/60 hover:text-white"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>

                        {/* List source options */}
                        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                          {driveSubtitleTracks.length > 0 ? (
                            <>
                              <div className="text-[9px] text-white/40 uppercase tracking-wider px-1 font-mono mb-1">
                                Google Drive Captions
                              </div>
                              {driveSubtitleTracks.map((track) => {
                                const isSelected = subtitleUrl?.includes(`/api/drive-subtitles/${actualVideoId}/${track.lang}`);
                                return (
                                  <button
                                    key={`${track.lang}-${track.name}`}
                                    onClick={() => {
                                      const url = `/api/drive-subtitles/${actualVideoId}/${track.lang}?name=${encodeURIComponent(track.name)}`;
                                      setSubtitleUrl(url);
                                      setShowSubtitleMenu(false);
                                    }}
                                    className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors flex items-center justify-between ${isSelected ? 'bg-[#9d4edd]/30 text-[#e1b1ff]' : 'hover:bg-white/5 text-white/80 hover:text-white'}`}
                                  >
                                    <span className="truncate">{track.label} {track.name ? `(${track.name})` : ''}</span>
                                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[#9d4edd]" />}
                                  </button>
                                );
                              })}
                            </>
                          ) : (
                            <div className="text-white/40 text-[10px] py-1 text-center font-mono">
                              No Drive Captions Detected
                            </div>
                          )}
                          
                          <div className="border-t border-white/10 my-2 pt-2" />

                          <div className="text-[9px] text-white/40 uppercase tracking-wider px-1 font-mono mb-1">
                            Options
                          </div>
                          
                          <button
                            onClick={() => {
                              fileInputRef.current?.click();
                              setShowSubtitleMenu(false);
                            }}
                            className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/5 text-white/80 hover:text-white transition-colors"
                          >
                            Upload Custom Track (.srt/.vtt)
                          </button>

                          {subtitleUrl && (
                            <button
                              onClick={() => {
                                setSubtitleUrl(null);
                                setShowSubtitleMenu(false);
                              }}
                              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-red-500/20 text-red-400 font-semibold transition-colors mt-1"
                            >
                              Turn Off Subtitles
                            </button>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
              <button
                onClick={toggleFullscreen}
                className="w-6 h-6 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-md border border-white/10 flex items-center justify-center transition-colors"
                title="Toggle Fullscreen"
              >
                {isFullscreen ? <Minimize className="w-3 h-3" /> : <Maximize className="w-3 h-3" />}
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
                     placeholder="Place the next link..."
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

      <AnimatePresence>
         {activeReactions.map(reaction => (
           <motion.div
             key={reaction.id}
             initial={{ opacity: 1, y: 0, x: isEffectiveChatOverlayMode ? ((window.innerWidth < 768 ? 20 : 40) + reaction.startX) : (window.innerWidth - 180 + reaction.startX), scale: 0.5 }}
             animate={{ opacity: 0, y: -200 - Math.random() * 200, x: (isEffectiveChatOverlayMode ? ((window.innerWidth < 768 ? 20 : 40) + reaction.startX + (Math.random() * 80 - 40)) : (window.innerWidth - 180 + reaction.startX + (Math.random() * 80 - 40))), scale: 1.5 }}
             exit={{ opacity: 0 }}
             transition={{ duration: 1.5 + Math.random() * 0.5, ease: "easeOut" }}
             className="fixed bottom-[140px] text-4xl drop-shadow-xl z-[200] pointer-events-none"
           >
             {reaction.emoji}
           </motion.div>
         ))}
      </AnimatePresence>

      {/* Chat Area (Right Side or Bottom or Overlay) */}
      <AnimatePresence initial={false}>
        {(isChatVisible || isChatTemporarilyVisible) && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={
              isEffectiveChatOverlayMode
                ? `absolute bottom-24 left-4 md:left-8 h-[50vh] w-[90vw] md:w-[320px] bg-transparent border-none flex flex-col shrink-0 overflow-hidden z-[60] transition-opacity duration-500 ${(isUserActive || isChatTemporarilyVisible) ? "opacity-100" : "opacity-0 pointer-events-none"}`
                : `h-[40vh] md:h-full md:w-[320px] w-full bg-[#0d0d0d] border-t md:border-t-0 md:border-l border-white/5 flex flex-col shrink-0 overflow-hidden ${isChatTemporarilyVisible && !isChatVisible ? 'fixed right-0 bottom-0 md:top-0 z-[100]' : 'relative z-[60]'} shadow-2xl transition-all`
            }
          >
            {/* Chat Head */}
            <div className={`p-4 ${isEffectiveChatOverlayMode ? "border-transparent" : "border-b border-white/5"} flex items-center justify-between shrink-0 pointer-events-auto transition-opacity duration-500 ${isEffectiveChatOverlayMode && !isUserActive && !isChatTemporarilyVisible ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
               <span className="text-[10px] font-mono text-white/50 uppercase tracking-widest flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live Chat
               </span>
               <div className="flex items-center gap-2">
                 {!isFullscreen && (
                   <button
                      onClick={() => setIsChatOverlayMode(!isChatOverlayMode)}
                      className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors backdrop-blur-md"
                      title={isChatOverlayMode ? "Switch to Sidebar" : "Switch to Overlay"}
                   >
                     <Layout className="w-4 h-4" />
                   </button>
                 )}
                 <button
                    onClick={() => {
                      setIsChatVisible(false);
                      setIsChatTemporarilyVisible(false);
                    }}
                    className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors backdrop-blur-md"
                 >
                   <ArrowRight className={`w-4 h-4 ${isEffectiveChatOverlayMode ? 'rotate-90' : 'md:hidden rotate-90'}`} />
                   <ArrowRight className={`w-4 h-4 hidden ${isEffectiveChatOverlayMode ? '' : 'md:block'}`} />
                 </button>
               </div>
            </div>            {/* Messages */}
            <div 
              ref={chatContainerRef}
              onScroll={handleChatScroll}
              className={`flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar pointer-events-auto relative transition-opacity duration-500 ${isEffectiveChatOverlayMode && !isUserActive && !isChatTemporarilyVisible ? "opacity-0 pointer-events-none" : "opacity-100"}`}
              style={{ maskImage: isEffectiveChatOverlayMode ? 'linear-gradient(to top, black 80%, transparent)' : 'none', WebkitMaskImage: isEffectiveChatOverlayMode ? 'linear-gradient(to bottom, transparent, black 20%, black 90%, transparent)' : 'none' }}
            >
               {messages.filter(m => !m.message_text?.startsWith("[EMOJI]:")).map((msg) => {
                   if (msg.username === "System") {
                     return (
                       <div key={msg.id} className="w-full text-center py-1.5 my-1 text-xs text-white/40 italic font-medium tracking-wide flex items-center justify-center gap-3">
                         <span className="h-[1px] flex-1 bg-white/5 max-w-[24px]" />
                         <span>{msg.message_text}</span>
                         <span className="h-[1px] flex-1 bg-white/5 max-w-[24px]" />
                       </div>
                     );
                   }
                  const replyMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
                  const isMe = msg.username === username;
                  const isRightAligned = !isEffectiveChatOverlayMode && isMe;
                  return (
                  <div key={msg.id} className={`flex flex-col gap-1 w-full max-w-[90%] drop-shadow-lg group relative ${isRightAligned ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                    <span className={`text-[10px] text-white/60 uppercase font-bold tracking-wider mx-1 ${isEffectiveChatOverlayMode ? "drop-shadow-md" : ""}`}>
                      {msg.username}
                    </span>
                    <div className={`px-4 py-2.5 text-sm leading-relaxed relative ${isEffectiveChatOverlayMode ? "bg-transparent border-none text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] px-0" : `text-white/90 backdrop-blur-sm ${isMe ? "bg-[#9d4edd]/50 border border-[#9d4edd]/50 rounded-2xl rounded-tr-sm" : "bg-black/60 border border-white/10 rounded-2xl rounded-tl-sm"}`}`}>
                       {replyMsg && (
                         <div className="text-xs bg-black/20 p-2 rounded-lg mb-2 border-l-2 border-white/50">
                           <span className="font-bold text-white/50 text-[10px] uppercase block mb-0.5">{replyMsg.username}</span>
                           <span className="text-white/70 line-clamp-2">{replyMsg.message_text}</span>
                         </div>
                       )}
                       {msg.message_text}
                    </div>
                    <button 
                       onClick={() => { setReplyTarget(msg); document.getElementById('chat-input')?.focus(); }}
                       className={`absolute top-5 ${isRightAligned ? '-left-8' : '-right-8'} opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-black/40 hover:bg-black/80 rounded-full text-white/50 hover:text-white border border-white/5 backdrop-blur-md`}
                       title="Reply"
                    >
                       <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                    </button>
                  </div>
               )})}
               {typingUsers.length > 0 && (
                  <div className="flex items-center gap-2 px-1 py-1 text-xs text-white/50 italic mr-auto">
                    <div className="flex gap-1 items-center bg-white/5 border border-white/5 px-2.5 py-1.5 rounded-2xl rounded-tl-sm backdrop-blur-sm">
                      <span className="w-1.5 h-1.5 bg-[#9d4edd] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-1.5 h-1.5 bg-[#9d4edd] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-1.5 h-1.5 bg-[#9d4edd] rounded-full animate-bounce"></span>
                    </div>
                    <span className="text-[10px] tracking-wide text-white/40">
                      {typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing...
                    </span>
                  </div>
                )}
                <div ref={chatEndRef} />
            </div>

            {/* Scroll down indicator */}
            <AnimatePresence>
               {isScrolledUp && (
                 <motion.button
                   initial={{ opacity: 0, y: 10 }}
                   animate={{ opacity: 1, y: 0 }}
                   exit={{ opacity: 0, y: 10 }}
                   onClick={() => {
                     chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
                     setIsScrolledUp(false);
                   }}
                   className="absolute bottom-[200px] right-4 bg-[#9d4edd] hover:bg-[#833bc2] text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-colors z-50 pointer-events-auto"
                 >
                   <ArrowDown className="w-4 h-4" />
                 </motion.button>
               )}
            </AnimatePresence>

            {/* Input Form */}
            <div className={`${isEffectiveChatOverlayMode ? "bg-transparent border-transparent" : "bg-black/40 border-t border-white/5"} shrink-0 relative flex flex-col pointer-events-auto transition-opacity duration-500 ${isEffectiveChatOverlayMode && !isUserActive && !isChatTemporarilyVisible ? "opacity-0 pointer-events-none" : "opacity-100"}`}>
              <form onSubmit={handleSendMessage} className="p-4 flex gap-2 relative flex-col">
                {replyTarget && (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-2 flex items-start justify-between mb-2">
                    <div className="flex flex-col text-xs overflow-hidden">
                      <span className="font-bold text-[#9d4edd] uppercase tracking-wider text-[10px] mb-0.5">Replying to {replyTarget.username}</span>
                      <span className="text-white/70 line-clamp-1 truncate">{replyTarget.message_text}</span>
                    </div>
                    <button type="button" onClick={() => setReplyTarget(null)} className="text-white/40 hover:text-white p-1">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
                <div className="relative flex w-full">
                  <input
                    id="chat-input"
                    type="text"
                    autoComplete="off"
                    className={`w-full pl-4 pr-12 py-3 bg-white/10 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-sm text-white ${isEffectiveChatOverlayMode ? "backdrop-blur-md shadow-xl" : ""}`}
                    placeholder="Message..."
                    value={newMessage}
                    onChange={handleInputChange}
                  />
                  <button
                    type="submit"
                    disabled={!newMessage.trim()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-[#9d4edd] hover:bg-[#833bc2] rounded-md flex items-center justify-center disabled:opacity-50 transition-colors text-white cursor-pointer"
                  >
                    <ArrowRight className="w-4 h-4 -rotate-45" />
                  </button>
                </div>
              </form>
              <div className="px-4 pb-4 flex gap-2 overflow-x-auto custom-scrollbar">
                 {["😂", "❤️", "🔥", "👍", "👏", "😮", "🎉"].map(emoji => (
                   <button
                      key={emoji}
                      type="button"
                      onClick={() => handleSendEmoji(emoji)}
                      className={`w-8 h-8 shrink-0 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors text-sm border border-white/5 hover:border-white/20 ${isEffectiveChatOverlayMode ? "backdrop-blur-md shadow-lg" : ""}`}
                   >
                     {emoji}
                   </button>
                 ))}
              </div>
            </div>
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
