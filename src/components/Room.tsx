import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { 
  Copy, Check, MessageSquare, Zap, LogOut, ArrowRight, ArrowDown, Layout, X, 
  Maximize, Minimize, Subtitles, Settings, Calendar, History, Volume2, VolumeX, 
  Users, Play, Pause, Clock, ShieldAlert, Heart, Laugh, Flame, ThumbsUp, Send, 
  ChevronRight, Mic, MicOff, RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { RoomStatus, ChatMessage } from "../types";

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

const formatMsgTime = (timestampStr: string) => {
  if (!timestampStr) return "";
  try {
    let cleanStr = timestampStr.trim();
    if (!cleanStr.includes("T") && cleanStr.includes(" ")) {
      cleanStr = cleanStr.replace(" ", "T");
    }
    if (!cleanStr.endsWith("Z") && !cleanStr.includes("+") && !cleanStr.includes("-")) {
      cleanStr += "Z";
    }
    const date = new Date(cleanStr);
    if (isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
};

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  // Roster identity and prompt checks
  const [username, setUsername] = useState(localStorage.getItem("syncStream_username") || "");
  const [promptUsername, setPromptUsername] = useState("");
  const [sessionId] = useState(localStorage.getItem("syncStream_sessionId") || Math.random().toString(36).substring(2, 15));
  
  // Status and core feeds
  const [roomStatus, setRoomStatus] = useState<RoomStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  
  // Navigation states
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [isChatTemporarilyVisible, setIsChatTemporarilyVisible] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [ytApiReady, setYtApiReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resolvedDriveUrl, setResolvedDriveUrl] = useState<string | null>(null);
  const [activeReactions, setActiveReactions] = useState<{id: number, emoji: string, startX: number}[]>([]);

  // Advanced feature views & widths
  const [viewMode, setViewMode] = useState<"cinema" | "chat-focused" | "live">("chat-focused");
  const [sidebarTab, setSidebarTab] = useState<"chat" | "roster" | "settings">("chat");
  const [chatWidth, setChatWidth] = useState(360);
  const [isResizing, setIsResizing] = useState(false);

  // Unified controller States
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBufferingState, setIsBufferingState] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(document.fullscreenElement !== null);

  // Moderation state
  const [participants, setParticipants] = useState<any[]>([]);
  const [isMyMutedText, setIsMyMutedText] = useState(false);
  const [myLobbyStatus, setMyLobbyStatus] = useState("approved");

  // Break states
  const [roomBreakEndTime, setRoomBreakEndTime] = useState<number | null>(null);
  const [breakMinutes, setBreakMinutes] = useState(5);

  // Voice WebRTC Voice states
  const [isVoiceConnected, setIsVoiceConnected] = useState(false);
  const [localAudioStream, setLocalAudioStream] = useState<MediaStream | null>(null);
  const [speachCycle, setSpeachCycle] = useState(0);

  // Subtitles
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [driveSubtitleTracks, setDriveSubtitleTracks] = useState<{ lang: string; name: string; label: string }[]>([]);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);

  // User activity & typing
  const [isUserActive, setIsUserActive] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [isChatOverlayMode, setIsChatOverlayMode] = useState(false);
  const [nextVideoUrl, setNextVideoUrl] = useState("");
  const [isOverlayActive, setIsOverlayActive] = useState(true);
  const [isChatHovered, setIsChatHovered] = useState(false);
  const [isChatFocused, setIsChatFocused] = useState(false);
  const overlayActivityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isEffectiveChatOverlayMode = isFullscreen || isChatOverlayMode || viewMode === "cinema";
  
  const isTypingRef = useRef(false);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isDrive = roomStatus?.videoId?.startsWith("drive:");
  const actualVideoId = roomStatus?.videoId?.replace(/^(yt:|drive:)/, "") || roomStatus?.videoId;

  useEffect(() => {
    isTypingRef.current = isTyping;
  }, [isTyping]);

  useEffect(() => {
    localStorage.setItem("syncStream_sessionId", sessionId);
  }, [sessionId]);

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
    },
    setVolume: (vol: number) => {
      if (isDrive && html5VideoRef.current) html5VideoRef.current.volume = vol / 100;
      if (!isDrive && playerRef.current?.setVolume) playerRef.current.setVolume(vol);
    },
    setPlaybackRate: (rate: number) => {
      if (isDrive && html5VideoRef.current) html5VideoRef.current.playbackRate = rate;
      if (!isDrive && playerRef.current?.setPlaybackRate) playerRef.current.setPlaybackRate(rate);
    }
  });

  // Autoscroll chat and floating emoji spawns
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      const newMessages = messages.slice(prevMessagesLength.current);
      
      const newReactions = newMessages.filter(m => m.message_text?.startsWith("[EMOJI]:") && !playedReactionsRef.current.has(m.id));
      if (newReactions.length > 0) {
         newReactions.forEach(r => playedReactionsRef.current.add(r.id));
         const spawns = newReactions.flatMap(m => {
            const emoji = m.message_text.replace("[EMOJI]:", "");
            return Array.from({length: 6}).map(() => ({
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
           }, 4000);
        }
        if (!isScrolledUp) {
          setTimeout(() => {
            chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
          }, 100);
        }
      }
      prevMessagesLength.current = messages.length;
    }
  }, [messages, isChatVisible, isEffectiveChatOverlayMode, isScrolledUp]);

  // Resizer for sidebar chat Width
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const computedWidth = window.innerWidth - e.clientX;
      if (computedWidth > 260 && computedWidth < 550) {
        setChatWidth(computedWidth);
      }
    };
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Detect user inactive for controls display fade
  useEffect(() => {
    const handleActivity = () => {
      setIsUserActive(true);
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
      activityTimeoutRef.current = setTimeout(() => {
        setIsUserActive(false);
      }, 5000);
    };

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("touchstart", handleActivity);
    
    handleActivity();

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
      if (activityTimeoutRef.current) clearTimeout(activityTimeoutRef.current);
    };
  }, []);

  // Detect user inactive for Cinema Mode transparent chat overlay auto-hide
  useEffect(() => {
    if (viewMode !== "cinema") {
      setIsOverlayActive(true);
      return;
    }

    if (isChatHovered || isChatFocused) {
      setIsOverlayActive(true);
      if (overlayActivityTimeoutRef.current) {
        clearTimeout(overlayActivityTimeoutRef.current);
        overlayActivityTimeoutRef.current = null;
      }
      return;
    }

    const handleCinemaActivity = () => {
      setIsOverlayActive(true);
      if (overlayActivityTimeoutRef.current) clearTimeout(overlayActivityTimeoutRef.current);
      overlayActivityTimeoutRef.current = setTimeout(() => {
        setIsOverlayActive(false);
      }, 3000);
    };

    const events = ["mousemove", "keydown", "pointermove", "click"];
    events.forEach(event => {
      window.addEventListener(event, handleCinemaActivity);
    });

    handleCinemaActivity();

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleCinemaActivity);
      });
      if (overlayActivityTimeoutRef.current) clearTimeout(overlayActivityTimeoutRef.current);
    };
  }, [viewMode, isChatHovered, isChatFocused]);

  // Poll status, roster list & messages continuously
  useEffect(() => {
    if (!isPlayerReady || !roomId || !username) return;

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
          const currentTimeVal = unifiedPlayer.getCurrentTime();
          const playerState = unifiedPlayer.getPlayerState();
          const isPausedVal = playerState === 2 || playerState === -1;

          try {
            await fetch(`/api/room/${roomId}/update`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                currentTimestamp: currentTimeVal,
                isPaused: isPausedVal,
                sessionId: sessionId,
                videoId: roomStatus?.videoId,
              }),
            });
          } catch (e) {}
        }
      } else {
        // Guest pulls state
        try {
          const response = await fetch(`/api/room/${roomId}/status`);
          if (response.ok) {
            const status: RoomStatus = await response.json();
            setRoomStatus(status);

            if (status.breakEndTime) {
              setRoomBreakEndTime(status.breakEndTime);
            } else {
              setRoomBreakEndTime(null);
            }

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

            // Pause if scheduled break is active
            const isBreakRunning = status.breakEndTime && Date.now() < status.breakEndTime;

            if (isPlayerVideoMatching) {
              const localTime = unifiedPlayer.getCurrentTime();
              const timeDiff = Math.abs(localTime - status.currentTimestamp);

              const playerState = unifiedPlayer.getPlayerState();

              if ((status.isPaused || isBreakRunning) && playerState === 1) {
                unifiedPlayer.pauseVideo();
              } else if (!status.isPaused && !isBreakRunning && (playerState === 2 || playerState === -1)) {
                unifiedPlayer.playVideo();
              }

              if (timeDiff > 2.2 && !isBreakRunning) {
                unifiedPlayer.seekTo(status.currentTimestamp, true);
              }
            }
          }
        } catch (e) {}
      }

      // Sync user history progress context
      if (username) {
        try {
          fetch("/api/user/recent-rooms/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username,
              roomId,
              videoId: roomStatus?.videoId,
              lastTimestamp: Math.round(unifiedPlayer.getCurrentTime())
            })
          }).catch(() => {});
        } catch (e) {}
      }

      // Read messages and reactions feed
      try {
        const msgResponse = await fetch(`/api/room/${roomId}/messages`);
        if (msgResponse.ok) {
          const newMessages = await msgResponse.json();
          setMessages(newMessages);
        }
      } catch (e) {}

      // Heartbeat including buffering status
      if (username) {
        try {
          const hbResponse = await fetch(`/api/room/${roomId}/heartbeat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username,
              sessionId,
              isTyping: isTypingRef.current,
              isBuffering: isBufferingState
            }),
          });
          if (hbResponse.ok) {
            const hbData = await hbResponse.json();
            
            // Handle host kicked guest redirection
            if (hbData.kicked) {
              clearInterval(pollingIntervalRef.current!);
              alert("You have been kicked out of this CinemaSync session by the host.");
              navigate("/");
              return;
            }

            if (hbData.success) {
              setParticipants(hbData.activeUsers || []);
              setIsMyMutedText(!!hbData.isMuted);
              setMyLobbyStatus(hbData.status || "approved");
            }
          }
        } catch (e) {}
      }
    }, 1500);

    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, [isPlayerReady, isHost, roomId, sessionId, isDrive, roomStatus?.videoId, actualVideoId, username, isBufferingState]);

  // Smooth local timeline ticking updates
  useEffect(() => {
    if (!isPlayerReady) return;
    const interval = setInterval(() => {
      const p = getUnifiedPlayer();
      try {
        const curr = p.getCurrentTime();
        if (typeof curr === "number" && !isNaN(curr)) {
          setCurrentTime(curr);
        }
        
        let dur = 0;
        if (isDrive && html5VideoRef.current) {
          dur = html5VideoRef.current.duration;
        } else if (!isDrive && playerRef.current && typeof playerRef.current.getDuration === "function") {
          dur = playerRef.current.getDuration();
        }
        if (typeof dur === "number" && !isNaN(dur) && dur > 0) {
          setDuration(dur);
        }

        const state = p.getPlayerState();
        setIsPlaying(state === 1);
        setIsBufferingState(state === 3); // YT.PlayerState.BUFFERING is 3, HTML5 buffering handled below
      } catch (e) {}
    }, 250);

    return () => clearInterval(interval);
  }, [isPlayerReady, isDrive]);

  // Track HTML5 buffer trigger
  useEffect(() => {
    const video = html5VideoRef.current;
    if (!video || !isDrive) return;

    const handleWaiting = () => setIsBufferingState(true);
    const handlePlaying = () => setIsBufferingState(false);

    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);

    return () => {
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
    };
  }, [isDrive, resolvedDriveUrl]);

  // Initialize YT / HTML5 dependencies
  // Load room details
  useEffect(() => {
    if (!roomId || !username) return;

    const loadRoom = async () => {
      try {
        const res = await fetch(`/api/room/${roomId}/status`);
        if (!res.ok) {
          setLoadError("CinemaSync room does not exist.");
          return;
        }
        const data: RoomStatus = await res.json();
        setRoomStatus(data);

        if (data.breakEndTime) {
          setRoomBreakEndTime(data.breakEndTime);
        }

        const isMeHost = data.hostSessionId === sessionId;
        setIsHost(isMeHost);
      } catch (err) {
        setLoadError("Communication error checking room.");
      }
    };

    loadRoom();
  }, [roomId, sessionId, username]);

  // Load YouTube Iframe API script on mount if needed
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

      window.onYouTubeIframeAPIReady = () => setYtApiReady(true);
    } else {
      setYtApiReady(true);
    }
  }, []);

  // Synchronize active video content when roomStatus videoId changes
  useEffect(() => {
    if (!roomStatus?.videoId) return;

    setIsPlayerReady(false);

    if (isDrive) {
      const fileId = roomStatus.videoId.replace("drive:", "");
      const expectedUrl = `/api/proxy-video/${fileId}`;
      setResolvedDriveUrl(expectedUrl);
      
      fetch(`/api/drive-subtitles-list/${fileId}`)
        .then(res => res.json())
        .then(subData => {
          if (subData.success && subData.tracks) {
            setDriveSubtitleTracks(subData.tracks);
          } else {
            setDriveSubtitleTracks([]);
          }
        }).catch(e => {
          console.error(e);
          setDriveSubtitleTracks([]);
        });
        
    } else {
      setResolvedDriveUrl(null);
      setDriveSubtitleTracks([]);
      
      if (playerRef.current && typeof playerRef.current.loadVideoById === "function") {
        try {
          playerRef.current.loadVideoById({
            videoId: actualVideoId,
            startSeconds: roomStatus.currentTimestamp || 0
          });
          setIsPlayerReady(true);
        } catch (e) {
          console.error("Failed to load video on existing player instance", e);
        }
      }
    }
  }, [roomStatus?.videoId, actualVideoId]);

  // Instantiate YouTube Client once ready
  useEffect(() => {
    if (!ytApiReady || !roomStatus || isDrive || playerRef.current) return;

    const vId = actualVideoId;
    playerRef.current = new window.YT.Player("youtube-player", {
      videoId: vId,
      playerVars: {
        controls: 0,
        autoplay: 1,
        disablekb: 1,
        fs: 0,
        rel: 0,
        modestbranding: 1
      },
      events: {
        onReady: () => {
          setIsPlayerReady(true);
          
          // Check for URL resume parameters on entry
          const params = new URLSearchParams(window.location.search);
          if (params.get("resume") === "true") {
             const time = parseFloat(params.get("time") || "0");
             playerRef.current.seekTo(time, true);
          }
        },
        onStateChange: (event: any) => {
          setIsPlaying(event.data === 1);
          setIsBufferingState(event.data === 3);
        }
      }
    });
  }, [ytApiReady, roomStatus, isDrive, actualVideoId]);

  // Instantiate HTML5 direct video once src is set
  useEffect(() => {
    if (isDrive && resolvedDriveUrl && html5VideoRef.current && !isPlayerReady) {
      setIsPlayerReady(true);

      const params = new URLSearchParams(window.location.search);
      if (params.get("resume") === "true" && html5VideoRef.current) {
         html5VideoRef.current.currentTime = parseFloat(params.get("time") || "0");
      }
    }
  }, [isDrive, resolvedDriveUrl, isPlayerReady]);

  // Voice Chat Web Audio context simulated indicator
  const handleToggleVoice = async () => {
     if (isVoiceConnected) {
       if (localAudioStream) {
         localAudioStream.getTracks().forEach(t => t.stop());
         setLocalAudioStream(null);
       }
       setIsVoiceConnected(false);
     } else {
       try {
         const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
         if (stream) setLocalAudioStream(stream);
         setIsVoiceConnected(true);

         // Simulate talking indicators
         const interval = setInterval(() => {
            if (!isVoiceConnected) {
              clearInterval(interval);
              return;
            }
            setSpeachCycle(prev => prev + 1);
         }, 300);
       } catch (err) {
         setIsVoiceConnected(true);
       }
     }
  };

  // Host Moderation Handlers
  const handleModerationAction = async (targetSession: string, actionName: string) => {
    try {
      const response = await fetch(`/api/room/${roomId}/moderation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          targetSessionId: targetSession,
          action: actionName
        })
      });
      if (response.ok) {
        // Fast sync local
        setParticipants(prev => prev.map(p => {
          if (p.sessionId === targetSession) {
            if (actionName === "mute") return { ...p, isMuted: true };
            if (actionName === "unmute") return { ...p, isMuted: false };
            if (actionName === "approve") return { ...p, status: "approved" };
          }
          return p;
        }).filter(p => !(p.sessionId === targetSession && (actionName === "kick" || actionName === "deny"))));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Scheduled break triggers
  const handleLaunchBreak = async () => {
    if (!isHost) return;
    const endSeconds = Date.now() + breakMinutes * 60 * 1000;
    try {
      await fetch(`/api/room/${roomId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          currentTimestamp: getUnifiedPlayer().getCurrentTime(),
          isPaused: true,
          breakEndTime: endSeconds
        })
      });
      setRoomBreakEndTime(endSeconds);
    } catch (e) {}
  };

  const handleCancelBreak = async () => {
    if (!isHost) return;
    try {
      await fetch(`/api/room/${roomId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          breakEndTime: null,
          isPaused: true
        })
      });
      setRoomBreakEndTime(null);
    } catch (e) {}
  };

  // Add micro message emoji toggle reactions
  const handleToggleReaction = async (messageId: number, emoji: string) => {
    try {
      const res = await fetch(`/api/message/${messageId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, emoji })
      });
      if (res.ok) {
        const msgResponse = await fetch(`/api/room/${roomId}/messages`);
        if (msgResponse.ok) {
          const fresh = await msgResponse.json();
          setMessages(fresh);
        }
      }
    } catch (e) {}
  };

  // Direct Inline Signin for guests joining links
  const handleInlineGuestRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptUsername.trim()) return;
    localStorage.setItem("syncStream_username", promptUsername.trim());
    setUsername(promptUsername.trim());
  };

  // Fullscreen and PiP setups
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  const togglePictureInPicture = async () => {
    if (html5VideoRef.current && document.pictureInPictureEnabled) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else {
          await html5VideoRef.current.requestPictureInPicture();
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleSubtitleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setSubtitleUrl(url);
    }
  };

  const handleChatScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const isUp = scrollHeight - scrollTop - clientHeight > 100;
    setIsScrolledUp(isUp);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !username) return;

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setIsTyping(false);

    try {
      const response = await fetch(`/api/room/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          sessionId,
          messageText: newMessage,
          replyToId: replyTarget ? replyTarget.id : null,
        }),
      });
      
      if (!response.ok) {
        const err = await response.json();
        alert(err.error || "Failed to send message.");
      } else {
        setNewMessage("");
        setReplyTarget(null);
      }
    } catch (err) {}
  };

  const handleSendEmoji = async (emoji: string) => {
    if (!username) return;
    try {
      await fetch(`/api/room/${roomId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
           username, 
           sessionId, 
           messageText: `[EMOJI]:${emoji}` 
        }),
      });
    } catch (e) {}
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    if (!isTyping) setIsTyping(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 2000);
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
          setResolvedDriveUrl(data.videoId.startsWith("drive:") ? `/api/proxy-video/${data.videoId.replace("drive:", "")}` : null);
        }
        setNextVideoUrl("");
      }
    } catch (error) {}
  };

  const uiOpacityClass = isUserActive ? "opacity-100" : "opacity-0 pointer-events-none";

  // Compute breakdown active
  const isBreakActive = roomBreakEndTime && Date.now() < roomBreakEndTime;
  const breakTimeLeft = roomBreakEndTime ? Math.max(0, Math.ceil((roomBreakEndTime - Date.now()) / 1000)) : 0;
  
  const formatBreakMinutes = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  // If waiting in lobby, show Wait Room Dashboard
  if (username && myLobbyStatus === "waiting") {
    return (
      <div className="w-screen h-screen bg-[#050505] flex flex-col items-center justify-center font-sans px-4 select-none relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-500/10 rounded-full blur-[140px]" />
        </div>
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full bg-[#0d0d0d] border border-white/10 rounded-2xl p-8 text-center space-y-6 shadow-2xl z-10">
          <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto text-[#bf8bff]">
            <Users className="w-6 h-6 animate-pulse" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white uppercase tracking-wider">Lobby Waiting Room</h2>
            <p className="text-xs text-white/50 leading-relaxed">
              This cinema party has host approval enabled. Please hold tightly until host approves your entry!
            </p>
          </div>
          <div className="flex justify-center items-center gap-1.5 p-3.5 bg-black/40 border border-white/5 rounded-xl text-yellow-400 font-mono text-[10px] uppercase tracking-widest leading-none">
             <RefreshCw className="w-3.5 h-3.5 animate-spin" />
             <span>Awaiting clearance...</span>
          </div>
          <button onClick={() => navigate("/")} className="text-red-400 text-xs font-bold uppercase tracking-widest hover:text-red-300 transition-colors pt-2 block mx-auto">
             Leave Lobby
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden w-screen h-screen bg-[#020202] font-sans select-none ${
      viewMode === "cinema" ? "" : "flex flex-col md:flex-row"
    }`}>
      
      {/* 1. Live View Mode: Roster Panel on Left (240px wide) */}
      {viewMode === "live" && (
        <div className="w-full md:w-60 bg-[#070707] border-b md:border-b-0 md:border-r border-white/5 flex flex-col shrink-0 overflow-y-auto p-4 space-y-5">
           <div className="flex items-center gap-2 mb-2 border-b border-white/5 pb-3">
             <Users className="w-4 h-4 text-[#9d4edd]" />
             <span className="text-[10px] font-mono tracking-widest text-white/70 uppercase">Roster Mesh</span>
           </div>
           
           {/* Voice mesh triggers */}
           <div className="p-3 bg-white/5 border border-white/5 rounded-xl space-y-2 text-left">
             <p className="text-[10px] text-white/55 font-bold uppercase tracking-wider">Voice Party</p>
             <button 
               onClick={handleToggleVoice}
               className={`w-full py-2 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${isVoiceConnected ? 'bg-green-600 text-white' : 'bg-white/5 hover:bg-white/10 text-white/80'}`}
             >
               {isVoiceConnected ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
               <span>{isVoiceConnected ? "Connected Voice" : "Join Channel"}</span>
             </button>
           </div>

           {/* Guest roster card */}
           <div className="space-y-2">
             {participants.map((u) => (
               <div key={u.sessionId} className="p-2.5 bg-black/40 border border-white/5 rounded-xl flex items-center justify-between text-left">
                  <div className="flex items-center gap-2 min-w-0">
                     <div className="relative shrink-0">
                       <span className="w-2.5 h-2.5 block rounded-full bg-white/15 border border-[#050505]">
                         {isVoiceConnected && (
                           <span className="absolute inset-0 block rounded-full bg-green-400 animate-ping opacity-80" />
                         )}
                       </span>
                     </div>
                     <span className="text-xs text-white/85 font-mono font-medium truncate">{u.username}</span>
                  </div>
                  <div className="flex items-center gap-1">
                     {u.isBuffering && (
                       <span className="w-3.5 h-3.5 border border-transparent border-t-purple-400 rounded-full animate-spin shrink-0" />
                     )}
                     {u.isMuted && (
                       <VolumeX className="w-3 h-3 text-red-500 shrink-0" />
                     )}
                  </div>
               </div>
             ))}
           </div>
        </div>
      )}

      {/* 2. Video block element (Center space) */}
      <div className={`${
        viewMode === "cinema" 
          ? "absolute inset-0 w-full h-full z-0 p-0 bg-black flex flex-col justify-center min-h-0 min-w-0" 
          : "flex-1 relative flex flex-col justify-center bg-black min-h-0 min-w-0 p-2 md:p-4"
      }`}>
        
        {/* Dynamic header row options with Presets layout */}
        <div className={`absolute top-0 left-0 right-0 z-40 p-3 flex justify-between items-center pointer-events-auto transition-opacity duration-300 bg-gradient-to-b from-black/80 to-transparent ${uiOpacityClass}`}>
           <div className="flex items-center gap-2.5">
              <div className="px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/25 flex items-center justify-center text-[#bf8bff]">
                <Zap className="w-3 h-3 fill-current animate-pulse" strokeWidth={2.5} />
              </div>
              <div className="text-left">
                <span className="text-xs font-bold text-white tracking-wide block">{roomStatus?.name || "CinemaSync Broadcast"}</span>
                <span className="text-[8px] text-white/50 font-mono uppercase tracking-widest">{isHost ? "Host Auth" : "Guest View Only"} • {username}</span>
              </div>
           </div>

           {/* Preset layout switcher */}
           <div className="hidden sm:flex items-center gap-1 bg-[#121212] border border-white/10 rounded-xl p-1 shrink-0">
             {(["cinema", "chat-focused", "live"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => {
                    setViewMode(mode);
                    setIsChatVisible(true);
                  }}
                  className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider rounded-lg transition-all ${viewMode === mode ? 'bg-[#9d4edd] text-white' : 'text-white/40 hover:text-white'}`}
                >
                  {mode}
                </button>
             ))}
           </div>

           <div className="flex items-center gap-2">
             <button
                onClick={() => {
                  navigator.clipboard.writeText(roomId || "");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-black/50 hover:bg-black/85 border border-white/10 rounded-xl text-[10px] text-white font-mono font-bold transition-all shrink-0 uppercase"
              >
                {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                <span>{roomId}</span>
              </button>
              <button 
                onClick={() => navigate("/")}
                className="w-8 h-8 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/30 border border-red-500/20 flex items-center justify-center transition-colors shrink-0"
                title="Exit Watch Party"
              >
                <LogOut className="w-4 h-4" />
              </button>
           </div>
        </div>

        {/* Video Canvas Container frame */}
        <div className={`relative w-full h-full bg-black overflow-hidden pointer-events-auto transition-all ${
          viewMode === "cinema" 
            ? "rounded-none border-0 shadow-none m-0 z-0 h-full w-full" 
            : "rounded-2xl border border-white/15 shadow-2xl z-0 mt-12 mb-1.5"
        }`}>
          <div id="youtube-player" className={`w-full h-full pointer-events-auto ${isDrive ? "hidden" : ""}`} />
          
          {isDrive && resolvedDriveUrl && (
            <video
              ref={html5VideoRef}
              src={resolvedDriveUrl}
              className="absolute inset-0 w-full h-full object-contain pointer-events-auto z-0"
              autoPlay
              onEnded={() => {
                if (isHost) setIsUserActive(true);
              }}
              onError={() => setLoadError("Could not render Drive stream track context. Enforce public access limits.")}
            >
              {subtitleUrl && <track key={subtitleUrl} kind="subtitles" src={subtitleUrl} srcLang="en" label="Local Track" default />}
            </video>
          )}

          {/* Invisible Overlay blocking standard YT frame clicks, to maintain perfect synchronization */}
          {!isDrive && (
             <div className="absolute inset-0 bg-transparent z-10 pointer-events-none" />
          )}

          {/* Break Overlay Screen */}
          {isBreakActive && (
             <div className="absolute inset-0 bg-black/95 z-40 flex flex-col items-center justify-center text-center p-6 text-white pointer-events-auto">
               <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6 max-w-sm">
                 <div className="w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center mx-auto text-[#bf8bff] animate-spin [animation-duration:15s]">
                   <Clock className="w-7 h-7" />
                 </div>
                 <div className="space-y-2">
                   <h2 className="text-2xl font-bold uppercase tracking-wider">Intermission Break</h2>
                   <p className="text-xs text-white/50 leading-relaxed">
                     Cinema pause scheduled by host. Chat with everyone below and grab some popcorn!
                   </p>
                 </div>
                 <div className="text-5xl font-mono font-bold tracking-tight text-[#d2adff] bg-white/5 border border-white/10 rounded-2xl py-4 inline-block px-8">
                   {formatBreakMinutes(breakTimeLeft)}
                 </div>
                 {isHost && (
                   <button onClick={handleCancelBreak} className="px-4 py-2 bg-red-600/10 hover:bg-red-600/30 text-red-400 font-bold text-[10px] uppercase tracking-widest rounded-xl transition-all border border-red-500/20 block mx-auto">
                      Cancel Break Period
                   </button>
                 )}
               </motion.div>
             </div>
          )}

          {/* Subtitles controls over custom menu */}
          {isDrive && (
            <div className="absolute top-16 right-4 z-40">
              <input 
                type="file" 
                accept=".srt,.vtt"
                ref={fileInputRef} 
                onChange={handleSubtitleUpload}
                className="hidden" 
              />
              <button
                onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
                className={`w-8 h-8 rounded-xl hover:scale-105 transition-all ${subtitleUrl ? 'bg-[#9d4edd]/50 text-white' : 'bg-black/60 text-white/70 hover:text-white'} border border-white/15 flex items-center justify-center`}
                title="Select Subtitles"
              >
                <Subtitles className="w-4 h-4" />
              </button>

              <AnimatePresence>
                {showSubtitleMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-56 bg-[#0c0c0c]/95 border border-white/10 rounded-xl p-3 shadow-2xl text-xs text-white z-50 text-left"
                  >
                    <div className="flex items-center justify-between border-b border-white/15 pb-2 mb-2 font-semibold">
                      <span>Subtitles Menu</span>
                      <button onClick={() => setShowSubtitleMenu(false)} className="text-white/50 hover:text-white">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {driveSubtitleTracks.length > 0 ? (
                        <>
                          <div className="text-[9px] text-white/40 uppercase tracking-wider px-1 font-mono mb-1">Google Drive Tracks</div>
                          {driveSubtitleTracks.map((track) => {
                            const isSel = subtitleUrl?.includes(`/api/drive-subtitles/${actualVideoId}/${track.lang}`);
                            return (
                              <button
                                key={`${track.lang}-${track.name}`}
                                onClick={() => {
                                  const url = `/api/drive-subtitles/${actualVideoId}/${track.lang}?name=${encodeURIComponent(track.name)}`;
                                  setSubtitleUrl(url);
                                  setShowSubtitleMenu(false);
                                }}
                                className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between ${isSel ? 'bg-[#9d4edd]/30 text-[#e1b1ff]' : 'hover:bg-white/5 text-white/80'}`}
                              >
                                <span className="truncate">{track.label}</span>
                                {isSel && <div className="w-1.5 h-1.5 rounded-full bg-[#9d4edd]" />}
                              </button>
                            );
                          })}
                        </>
                      ) : (
                        <div className="text-white/40 text-[10px] py-2 text-center font-mono">No Captions Detected</div>
                      )}
                      
                      <div className="border-t border-white/10 my-2 pt-2" />
                      <button onClick={() => { fileInputRef.current?.click(); setShowSubtitleMenu(false); }} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-white/5 text-[#dca2ff]">
                        Upload Custom Track (.vtt)
                      </button>

                      {subtitleUrl && (
                        <button onClick={() => { setSubtitleUrl(null); setShowSubtitleMenu(false); }} className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-red-500/10 text-red-400 mt-1">
                          Disable Subtitles
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Unified Custom Media Control UI Layer Overlay */}
          <div className={`absolute bottom-0 left-0 right-0 z-30 p-4 bg-gradient-to-t from-black/95 via-black/70 to-transparent flex flex-col gap-3 transition-opacity duration-300 pointer-events-auto ${uiOpacityClass}`}>
            
            {/* Timeline Progress Bar Row */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-white/70 select-none shrink-0">{formatBreakMinutes(Math.round(currentTime))}</span>
              <input 
                type="range"
                min={0}
                max={duration || 100}
                value={currentTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setCurrentTime(val);
                  if (isHost || !roomStatus?.onlyHostSync) {
                    getUnifiedPlayer().seekTo(val, true);
                    fetch(`/api/room/${roomId}/update`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        currentTimestamp: val,
                        isPaused: !isPlaying,
                        sessionId,
                        videoId: roomStatus?.videoId
                      })
                    }).catch(() => {});
                  }
                }}
                disabled={!isHost && roomStatus?.onlyHostSync}
                className="flex-1 h-1 bg-white/15 rounded-lg appearance-none cursor-pointer accent-[#9d4edd] focus:outline-none"
              />
              <span className="text-[10px] font-mono text-white/70 select-none shrink-0">{formatBreakMinutes(Math.round(duration))}</span>
            </div>

            {/* Core Action triggers row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-5">
                <button 
                  type="button"
                  onClick={() => {
                    const nextPlaying = !isPlaying;
                    setIsPlaying(nextPlaying);
                    const p = getUnifiedPlayer();
                    if (nextPlaying) p.playVideo();
                    else p.pauseVideo();

                    if (isHost || !roomStatus?.onlyHostSync) {
                      fetch(`/api/room/${roomId}/update`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          currentTimestamp: p.getCurrentTime(),
                          isPaused: !nextPlaying,
                          sessionId,
                          videoId: roomStatus?.videoId
                        })
                      }).catch(() => {});
                    }
                  }}
                  disabled={!isHost && roomStatus?.onlyHostSync}
                  className="text-[#9d4edd] hover:text-white hover:scale-105 transition-all disabled:opacity-30 shrink-0"
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
                </button>

                {/* Volume bar Controls */}
                <div className="flex items-center gap-1.5 group/vol">
                  <button 
                    type="button"
                    onClick={() => {
                      const modelMuted = !isMuted;
                      setIsMuted(modelMuted);
                      if (isDrive && html5VideoRef.current) {
                        html5VideoRef.current.muted = modelMuted;
                      } else if (!isDrive && playerRef.current) {
                        if (modelMuted) playerRef.current.mute();
                        else playerRef.current.unMute();
                      }
                    }}
                    className="text-white/60 hover:text-white transition-colors"
                  >
                    {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <input 
                    type="range"
                    min={0}
                    max={100}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      setVolume(v);
                      setIsMuted(false);
                      if (isDrive && html5VideoRef.current) {
                        html5VideoRef.current.volume = v / 100;
                        html5VideoRef.current.muted = false;
                      } else if (!isDrive && playerRef.current && typeof playerRef.current.setVolume === "function") {
                        playerRef.current.setVolume(v);
                        playerRef.current.unMute();
                      }
                    }}
                    className="w-0 group-hover/vol:w-16 h-1 rounded appearance-none bg-white/20 transition-all accent-[#9d4edd] cursor-pointer"
                  />
                </div>

                {!isHost && roomStatus?.onlyHostSync && (
                  <div className="flex items-center gap-1 bg-white/5 border border-white/5 px-2 py-0.5 rounded-md text-[9px] text-white/50 select-none font-mono">
                    <ShieldAlert className="w-3 h-3 text-purple-400" />
                    <span>Controls Jammed</span>
                  </div>
                )}
              </div>

              {/* Rate switches, PiP & full size toggles */}
              <div className="flex items-center gap-4">
                <select 
                  value={playbackSpeed}
                  onChange={(e) => {
                    const r = parseFloat(e.target.value);
                    setPlaybackSpeed(r);
                    getUnifiedPlayer().setPlaybackRate(r);
                  }}
                  className="bg-black/60 text-[10px] text-white/80 border border-white/10 rounded-lg px-2 py-1 font-mono cursor-pointer transition-colors"
                >
                  {[0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map(s => (
                     <option key={s} value={s}>{s}x</option>
                  ))}
                </select>

                {isDrive && (
                  <button onClick={togglePictureInPicture} className="text-white/60 hover:text-white transition-transform duration-100 hover:scale-105" title="Picture-in-Picture">
                     <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>
                  </button>
                )}

                <button onClick={toggleFullscreen} className="text-white/60 hover:text-white transition-transform duration-100 hover:scale-105">
                  {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Resizable Sidebar Chat Area (Tabs for Chat, Roster, and host options) */}
      <AnimatePresence initial={false}>
        {isChatVisible && (
          <div 
            onMouseEnter={() => setIsChatHovered(true)}
            onMouseLeave={() => setIsChatHovered(false)}
            className={`flex shrink-0 h-[45vh] md:h-full relative select-none text-left transition-all duration-500 ease-in-out ${
              viewMode === "cinema" 
                ? "absolute right-0 left-auto top-0 bottom-0 h-full w-[380px] z-50" 
                : "z-[60]"
            } ${
              viewMode === "cinema" 
                ? (isOverlayActive ? "opacity-100 pointer-events-auto visible" : "opacity-0 pointer-events-none invisible") 
                : ""
            }`}
          >
            
            {/* Draggable divider line */}
            <div 
              onMouseDown={handleMouseDown}
              className={`w-1 cursor-col-resize hover:bg-[#9d4edd] bg-transparent h-full transition-colors hidden md:block select-none shr-0 ${
                viewMode === "cinema" ? "hidden md:hidden" : ""
              }`}
              title="Drag to resize chat panel"
            />
            
            <motion.div 
              onFocusCapture={() => setIsChatFocused(true)}
              onBlurCapture={() => setIsChatFocused(false)}
              style={{ width: viewMode === "cinema" ? "100%" : (window.innerWidth < 768 ? "100%" : `${chatWidth}px`) }}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className={`${
                viewMode === "cinema" 
                  ? "bg-transparent backdrop-filter-none border-none shadow-none" 
                  : "bg-[#0b0c0e] border-t md:border-t-0 md:border-l border-white/5"
              } flex flex-col h-full overflow-hidden select-none`}
            >
              {/* Sidebar Header Tabs */}
              <div className={`flex p-2 gap-1.5 shrink-0 select-none ${
                viewMode === "cinema" ? "border-b-0 bg-transparent" : "border-b border-white/5 bg-black/30"
              }`}>
                <button 
                  onClick={() => setSidebarTab("chat")} 
                  className={`flex-1 flex justify-center items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${sidebarTab === "chat" ? 'bg-[#9d4edd]/20 text-white border border-[#9d4edd]/35' : 'text-white/40 hover:text-white border border-transparent'}`}
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>Chat</span>
                </button>
                <button 
                  onClick={() => setSidebarTab("roster")} 
                  className={`flex-1 flex justify-center items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${sidebarTab === "roster" ? 'bg-[#9d4edd]/20 text-white border border-[#9d4edd]/35' : 'text-white/40 hover:text-white border border-transparent'}`}
                >
                  <Users className="w-3 h-3" />
                  <span>Roster</span>
                </button>
                {isHost && (
                  <button 
                    onClick={() => setSidebarTab("settings")} 
                    className={`flex-1 flex justify-center items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider transition-all ${sidebarTab === "settings" ? 'bg-[#9d4edd]/20 text-white border border-[#9d4edd]/35' : 'text-white/40 hover:text-white border border-transparent'}`}
                  >
                    <Settings className="w-3 h-3" />
                    <span>Control</span>
                  </button>
                )}
              </div>

              {/* A. TAB: Chat list and message inputs */}
              {sidebarTab === "chat" && (
                <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
                  <div 
                    ref={chatContainerRef}
                    onScroll={handleChatScroll}
                    className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar animate-fade-in"
                  >
                     {messages.filter(m => !m.message_text?.startsWith("[EMOJI]:")).map((msg) => {
                         if (msg.username === "System") {
                           return (
                             <div key={msg.id} className="w-full text-center py-2 text-[10px] text-white/30 italic flex items-center justify-center gap-2">
                               <span className="h-[1px] flex-1 bg-white/5 max-w-[16px]" />
                               <span>{msg.message_text}</span>
                               <span className="h-[1px] flex-1 bg-white/5 max-w-[16px]" />
                             </div>
                           );
                         }
                         const isMe = msg.username === username;
                         const replyMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
                         
                         // Group toggling reaction count sums
                         const reactionCounts = msg.reactions?.reduce((acc, r) => {
                           acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                           return acc;
                         }, {} as Record<string, number>) || {};

                         return (
                           <div key={msg.id} className="flex flex-col gap-1 w-full max-w-[92%] relative group/bubble">
                             <div className="flex items-baseline gap-1.5 px-0.5">
                               <span className="text-[10px] text-white/55 font-bold uppercase tracking-wide">{msg.username}</span>
                               {msg.timestamp && (
                                 <span className="text-[9px] text-white/30 font-mono select-none">{formatMsgTime(msg.timestamp)}</span>
                               )}
                             </div>

                             {/* Parent Message Bubble Block */}
                             <div className={
                               viewMode === "cinema"
                                 ? "px-1 py-1.5 text-sm leading-relaxed text-white relative bg-transparent border-0 shadow-none"
                                 : `px-4 py-3 text-sm leading-relaxed rounded-2xl border ${isMe ? 'bg-[#9d4edd]/30 border-[#9d4edd]/35 text-white/95 rounded-tr-sm' : 'bg-black/45 border-white/5 text-white/90 rounded-tl-sm'} relative`
                             }>
                               {replyMsg && (
                                 <div className={`text-xs p-2 rounded-lg mb-2 border-l-2 border-purple-500 opacity-80 flex flex-col text-left ${
                                   viewMode === "cinema" ? "bg-black/40 border-white/10" : "bg-black/20"
                                 }`}>
                                   <span className="font-bold text-white/40 uppercase text-[9px]">{replyMsg.username}</span>
                                   <span className="truncate text-white/70 line-clamp-1">{replyMsg.message_text}</span>
                                 </div>
                               )}
                               <span className={viewMode === "cinema" ? "drop-shadow-[0_1.5px_1.5px_rgba(0,0,0,0.8)]" : ""}>{msg.message_text}</span>

                               {/* Dynamic custom micro toolbar on-hover */}
                               <div className="absolute right-1 -top-7 opacity-0 group-hover/bubble:opacity-100 transition-opacity bg-black/90 border border-white/10 rounded-lg p-1 flex gap-1.5 z-25 shadow-2xl">
                                 {["👍", "❤️", "😂", "🔥"].map(emoji => (
                                   <button 
                                     key={emoji} 
                                     type="button" 
                                     onClick={() => handleToggleReaction(msg.id, emoji)}
                                     className="hover:scale-120 text-xs transition-transform"
                                   >
                                      {emoji}
                                   </button>
                                 ))}
                                 <button
                                   onClick={() => { setReplyTarget(msg); document.getElementById('chat-input')?.focus(); }}
                                   className="p-0.5 text-white/40 hover:text-white"
                                   title="Reply in thread"
                                 >
                                   <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>
                                 </button>
                               </div>
                             </div>

                             {/* Bottom reactions aggregates container */}
                             {Object.keys(reactionCounts).length > 0 && (
                               <div className="flex gap-1 flex-wrap mt-1">
                                 {Object.entries(reactionCounts).map(([emoji, count]) => (
                                   <button
                                     key={emoji}
                                     onClick={() => handleToggleReaction(msg.id, emoji)}
                                     className={`px-2 py-0.5 border rounded-full text-[10px] font-mono font-bold flex items-center gap-1 transition-all ${
                                       viewMode === "cinema" 
                                         ? "bg-black/60 border-white/10 hover:bg-black/80 text-white/80" 
                                         : "bg-white/5 border-white/5 hover:bg-white/10 text-white/70"
                                     }`}
                                   >
                                     <span>{emoji}</span>
                                     <span className="text-[#bf8bff]">{count}</span>
                                   </button>
                                 ))}
                               </div>
                             )}
                           </div>
                         );
                     })}
                     {typingUsers.length > 0 && (
                        <div className="flex items-center gap-2 px-1 py-1 italic mr-auto">
                           <div className="flex gap-1 bg-white/5 border border-white/5 px-2.5 py-1.5 rounded-2xl rounded-tl-sm animate-pulse">
                             <span className="w-1.5 h-1.5 bg-[#9d4edd] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                             <span className="w-1.5 h-1.5 bg-[#9d4edd] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                             <span className="w-1.5 h-1.5 bg-[#9d4edd] rounded-full animate-bounce"></span>
                           </div>
                           <span className="text-[10px] font-mono text-white/35">typing...</span>
                        </div>
                     )}
                     <div ref={chatEndRef} />
                  </div>

                  {/* Typing input layouts form */}
                  <div className={`p-4 flex flex-col gap-2 ${
                    viewMode === "cinema"
                      ? "bg-transparent border-t-0"
                      : "bg-black/35 border-t border-white/5"
                  }`}>
                     {isMyMutedText && (
                        <div className="bg-red-500/10 border border-red-500/25 px-3 py-1.5 rounded-xl text-[10px] text-red-400 font-mono uppercase tracking-wider text-center">
                           Your text messaging is blocked by host.
                        </div>
                     )}
                     
                     <form onSubmit={handleSendMessage} className="flex flex-col gap-2 relative">
                        {replyTarget && (
                           <div className={`border rounded-xl p-2.5 flex items-start justify-between ${
                             viewMode === "cinema" ? "bg-black/80 border-white/15" : "bg-white/5 border-white/10"
                           }`}>
                             <div className="text-left select-none">
                               <span className="text-[9px] text-[#bf8bff] font-bold uppercase tracking-wider block">Thread reply target: {replyTarget.username}</span>
                               <span className="text-xs text-white/60 line-clamp-1 truncate">{replyTarget.message_text}</span>
                             </div>
                             <button type="button" onClick={() => setReplyTarget(null)} className="text-white/40 hover:text-white p-0.5">
                               <X className="w-3.5 h-3.5" />
                             </button>
                           </div>
                        )}
                        <div className="relative">
                          <input 
                            id="chat-input"
                            type="text"
                            placeholder="Type a message..."
                            disabled={isMyMutedText}
                            className={`w-full pl-4 pr-12 py-3 rounded-xl outline-none transition-all text-xs text-white disabled:opacity-40 ${
                              viewMode === "cinema"
                                ? "bg-black/75 border border-white/20 focus:border-[#9d4edd]/60 placeholder-white/30"
                                : "bg-white/5 border border-white/10 focus:border-[#9d4edd]/50 placeholder-white/40"
                            }`}
                            value={newMessage}
                            onChange={handleInputChange}
                          />
                          <button 
                            type="submit" 
                            disabled={!newMessage.trim() || isMyMutedText}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-[#9d4edd] hover:bg-[#8e3ecf] disabled:opacity-40 text-white flex items-center justify-center shrink-0"
                          >
                             <Send className="w-3.5 h-3.5" />
                          </button>
                        </div>
                     </form>

                     <div className="flex gap-1.5 overflow-x-auto py-1 max-w-full custom-scrollbar">
                       {["😂", "❤️", "🔥", "👍", "👏", "😮", "🎉"].map(emoji => (
                         <button
                           key={emoji}
                           type="button"
                           disabled={isMyMutedText}
                           onClick={() => handleSendEmoji(emoji)}
                           className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm disabled:opacity-45 ${
                             viewMode === "cinema"
                               ? "bg-black/60 hover:bg-black/85 border border-white/10 text-white"
                               : "bg-white/5 hover:bg-white/10 border border-white/5 text-white/95"
                           }`}
                         >
                           {emoji}
                         </button>
                       ))}
                     </div>
                  </div>
                </div>
              )}

              {/* B. TAB: Active Guest participants and moderator approvals */}
              {sidebarTab === "roster" && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="space-y-1 text-left">
                     <span className="text-[10px] text-white/35 font-mono uppercase tracking-widest block">Active Audience</span>
                     <p className="text-xs text-white/60 leading-relaxed font-sans">Wait approved list and moderation tools.</p>
                  </div>

                  <div className="space-y-2 pt-2 text-left">
                    {participants.map((u) => {
                      const isTargetHost = u.sessionId === roomStatus?.hostSessionId;
                      const isWaiting = u.status === "waiting";
                      
                      return (
                        <div key={u.sessionId} className="p-3 bg-[#111215] border border-white/5 rounded-xl space-y-2">
                           <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2 min-w-0">
                               <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                               <span className="text-xs font-mono text-white font-medium truncate">{u.username}</span>
                               {isTargetHost && (
                                 <span className="bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[8px] font-mono px-1.5 py-0.5 rounded uppercase font-bold">Host</span>
                               )}
                             </div>
                             
                             <div className="flex items-center gap-1.5">
                               {u.isBuffering && (
                                 <div className="w-3.5 h-3.5 border-2 border-transparent border-t-[#9d4edd] rounded-full animate-spin" />
                               )}
                               {isWaiting && (
                                 <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-[8px] uppercase tracking-wider font-bold">Lobby Wait</span>
                               )}
                             </div>
                           </div>

                           {/* Moderation Controls (Host authority check) */}
                           {isHost && !isTargetHost && (
                             <div className="flex gap-1.5 pt-1 border-t border-white/[0.03] flex-wrap">
                               {isWaiting ? (
                                 <>
                                   <button 
                                     onClick={() => handleModerationAction(u.sessionId, "approve")}
                                     className="px-2 py-1 bg-green-600/20 hover:bg-green-600 font-bold text-green-300 text-[9px] uppercase tracking-wider rounded border border-green-500/35 transition-all text-left"
                                   >
                                     Approve
                                   </button>
                                   <button 
                                     onClick={() => handleModerationAction(u.sessionId, "deny")}
                                     className="px-2 py-1 bg-red-600/20 hover:bg-red-600 font-bold text-red-300 text-[9px] uppercase tracking-wider rounded border border-red-500/35 transition-all text-left"
                                   >
                                     Deny
                                   </button>
                                 </>
                               ) : (
                                 <>
                                   <button 
                                     onClick={() => handleModerationAction(u.sessionId, u.isMuted ? "unmute" : "mute")}
                                     className="px-2 py-1 bg-white/5 hover:bg-white/10 text-white/80 text-[9px] uppercase tracking-wider rounded border border-white/10 font-bold transition-all text-left"
                                   >
                                     {u.isMuted ? "Unmute Text" : "Mute Text"}
                                   </button>
                                   <button 
                                     onClick={() => handleModerationAction(u.sessionId, "kick")}
                                     className="px-2 py-1 bg-red-500/15 hover:bg-red-500 text-red-300 text-[9px] uppercase tracking-wider rounded border border-red-500/25 font-bold transition-all text-left"
                                   >
                                     Kick
                                   </button>
                                 </>
                               )}
                             </div>
                           )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* C. TAB: Settings option (Host controls) */}
              {sidebarTab === "settings" && isHost && (
                <div className="flex-1 overflow-y-auto p-4 space-y-6 text-left">
                  <div className="space-y-1">
                     <span className="text-[10px] text-white/35 font-mono uppercase tracking-widest block">Authorization Locks</span>
                     <p className="text-xs text-white/60 leading-relaxed font-sans">Adjust rules on security, breaks, and lobby.</p>
                  </div>

                  {/* Lobby switches */}
                  <div className="space-y-4 pt-3 border-t border-white/5">
                     <label className="flex items-start justify-between cursor-pointer p-1">
                       <div className="flex flex-col pr-4">
                         <span className="text-xs font-bold text-white/90">Lobby Period Screening</span>
                         <span className="text-[10px] text-white/40 mt-0.5 leading-normal">Require host manual authorization click for guests</span>
                       </div>
                       <input 
                         type="checkbox" 
                         checked={!!roomStatus?.isLobbyEnabled} 
                         onChange={async (e) => {
                           const b = e.target.checked;
                           try {
                             await fetch(`/api/room/${roomId}/update`, {
                               method: "POST",
                               headers: { "Content-Type": "application/json" },
                               body: JSON.stringify({ sessionId, isLobbyEnabled: b })
                             });
                             setRoomStatus(prev => prev ? { ...prev, isLobbyEnabled: b } : null);
                           } catch (err) {}
                         }}
                         className="w-4.5 h-4.5 accent-[#9d4edd]" 
                       />
                     </label>

                     <label className="flex items-start justify-between cursor-pointer p-1">
                       <div className="flex flex-col pr-4">
                         <span className="text-xs font-bold text-white/90">Host-Only Sync Limits</span>
                         <span className="text-[10px] text-white/40 mt-0.5 leading-normal">Restrict play/pause seeking controls entirely to host</span>
                       </div>
                       <input 
                         type="checkbox" 
                         checked={!!roomStatus?.onlyHostSync} 
                         onChange={async (e) => {
                           const b = e.target.checked;
                           try {
                             await fetch(`/api/room/${roomId}/update`, {
                               method: "POST",
                               headers: { "Content-Type": "application/json" },
                               body: JSON.stringify({ sessionId, onlyHostSync: b })
                             });
                             setRoomStatus(prev => prev ? { ...prev, onlyHostSync: b } : null);
                           } catch (err) {}
                         }}
                         className="w-4.5 h-4.5 accent-[#9d4edd]" 
                       />
                     </label>
                  </div>

                  {/* Scheduling Interval Intermission Breaks */}
                  <div className="space-y-3.5 border-t border-white/5 pt-5">
                    <p className="text-xs font-bold text-white/85">Schedule Intermission Break</p>
                    <div className="p-3.5 bg-[#121316] border border-white/5 rounded-xl space-y-4">
                       <div className="flex justify-between text-[11px] font-mono">
                          <span className="text-white/50">Break Duration:</span>
                          <span className="text-[#bf8bff] font-bold">{breakMinutes} mins</span>
                       </div>
                       <input 
                         type="range"
                         min={1}
                         max={20}
                         value={breakMinutes}
                         onChange={(e) => setBreakMinutes(parseInt(e.target.value))}
                         className="w-full accent-[#9d4edd]"
                       />
                       
                       {isBreakActive ? (
                         <button 
                           onClick={handleCancelBreak}
                           className="w-full py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all"
                         >
                           Cancel Active Intermission
                         </button>
                       ) : (
                         <button 
                           onClick={handleLaunchBreak}
                           className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-[10px] uppercase tracking-widest rounded-lg transition-all shadow-glow"
                         >
                           Start Intermission Break
                         </button>
                       )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating spawn reactions canvas */}
      <AnimatePresence>
         {activeReactions.map(reaction => (
           <motion.div
             key={reaction.id}
             initial={{ opacity: 1, y: 0, x: isEffectiveChatOverlayMode ? (40 + reaction.startX) : (window.innerWidth - chatWidth - 60 + reaction.startX), scale: 0.5 }}
             animate={{ opacity: 0, y: -250 - Math.random() * 150, x: isEffectiveChatOverlayMode ? (40 + reaction.startX + (Math.random() * 80 - 40)) : (window.innerWidth - chatWidth - 60 + reaction.startX + (Math.random() * 80 - 40)), scale: 1.6 }}
             exit={{ opacity: 0 }}
             transition={{ duration: 1.5, ease: "easeOut" }}
             className="fixed bottom-[130px] text-5xl z-[200] pointer-events-none drop-shadow-2xl"
           >
             {reaction.emoji}
           </motion.div>
         ))}
      </AnimatePresence>

      {/* Roster Registration Overlay if unauthenticated guest user logs in directly via invite links */}
      {!username && (
        <div className="absolute inset-0 z-50 bg-[#050505] flex items-center justify-center p-4 text-white">
          <div className="absolute inset-0 z-0 pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px]" />
          </div>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full bg-[#0d0d0d] border border-white/10 rounded-2xl p-8 space-y-6 shadow-2xl z-10 text-center select-none">
             <div className="w-14 h-14 bg-purple-500/10 border border-purple-500/30 rounded-full flex items-center justify-center mx-auto text-[#bf8bff] mb-2">
                <Play className="w-5 h-5 fill-current" />
             </div>
             <div className="space-y-1.5">
                <h2 className="text-lg font-bold tracking-wider text-white uppercase select-none">Enter CinemaSync Session</h2>
                <p className="text-xs text-white/50 leading-relaxed font-sans select-none">
                  You are invited to a dynamic watch party session. Choose a human display identity tag to proceed.
                </p>
             </div>
             <form onSubmit={handleInlineGuestRegister} className="space-y-4">
               <input 
                 type="text" 
                 required
                 placeholder="CHOOSE DISPLAY NAME" 
                 value={promptUsername}
                 onChange={(e) => setPromptUsername(e.target.value)}
                 className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-[#9d4edd]/50 transition-all text-xs tracking-widest text-center uppercase text-white font-mono"
               />
               <button type="submit" className="w-full py-4 bg-[#9d4edd] hover:bg-[#8d3ecd] font-bold text-xs uppercase tracking-[0.2em] rounded-xl transition-all shadow-indigo-500/10 shadow-glow">
                  Join Audience
               </button>
             </form>
          </motion.div>
        </div>
      )}

      {/* Loading overlay */}
      {((!isPlayerReady && username) || loadError) && (
        <div className="absolute inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center text-white px-6">
          {loadError ? (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/30">
                <span className="text-red-500 text-2xl font-bold">!</span>
              </div>
              <h2 className="text-lg font-bold tracking-tight uppercase mb-2">Sync Error</h2>
              <p className="text-white/40 text-xs mb-8 max-w-xs mx-autoLeading-relaxed">{loadError}</p>
              <button onClick={() => navigate("/")} className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold uppercase tracking-widest transition-all">
                Return to Landing
              </button>
            </motion.div>
          ) : (
            <div className="text-center space-y-4 select-none">
              <div className="relative mb-6">
                <div className="w-16 h-16 border-[2px] border-white/5 border-t-[#9d4edd] rounded-full animate-spin mx-auto" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-[#9d4edd] fill-current animate-pulse" />
                </div>
              </div>
              <h2 className="text-[11px] font-bold tracking-[0.5em] text-white uppercase animate-pulse leading-none select-none">Launching Theatre</h2>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
