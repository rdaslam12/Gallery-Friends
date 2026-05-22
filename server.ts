import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import https from "https";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Database setup
  let db: any;
  try {
    db = new Database("./database.db");
    console.log("SQLite database initialized successfully.");
  } catch (err) {
    console.error("CRITICAL: Failed to open database", err);
    process.exit(1);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      room_id TEXT PRIMARY KEY,
      video_id TEXT,
      current_timestamp REAL DEFAULT 0,
      is_paused INTEGER DEFAULT 1,
      host_session_id TEXT,
      room_type TEXT DEFAULT 'EPHEMERAL',
      name TEXT,
      scheduled_at TEXT,
      is_lobby_enabled INTEGER DEFAULT 0,
      only_host_sync INTEGER DEFAULT 0,
      break_end_timestamp REAL,
      video_queue TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT,
      username TEXT,
      message_text TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_recent_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      room_id TEXT,
      video_id TEXT,
      last_timestamp REAL DEFAULT 0,
      last_visited DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(username, room_id)
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER,
      username TEXT,
      emoji TEXT,
      UNIQUE(message_id, username)
    );
  `);

  // Schema alterations for seamless backward-compatibility upgrades
  try {
    db.prepare("SELECT reply_to_id FROM messages LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER;");
  }

  try {
    db.prepare("SELECT room_type FROM rooms LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE rooms ADD COLUMN room_type TEXT DEFAULT 'EPHEMERAL';");
  }

  try {
    db.prepare("SELECT name FROM rooms LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE rooms ADD COLUMN name TEXT;");
  }

  try {
    db.prepare("SELECT scheduled_at FROM rooms LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE rooms ADD COLUMN scheduled_at TEXT;");
  }

  try {
    db.prepare("SELECT is_lobby_enabled FROM rooms LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE rooms ADD COLUMN is_lobby_enabled INTEGER DEFAULT 0;");
  }

  try {
    db.prepare("SELECT only_host_sync FROM rooms LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE rooms ADD COLUMN only_host_sync INTEGER DEFAULT 0;");
  }

  try {
    db.prepare("SELECT break_end_timestamp FROM rooms LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE rooms ADD COLUMN break_end_timestamp REAL;");
  }

  try {
    db.prepare("SELECT video_queue FROM rooms LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE rooms ADD COLUMN video_queue TEXT DEFAULT '[]';");
  }

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", db: !!db });
  });

  // Auth Routes
  app.post("/api/register", (req, res) => {
    const { username, email, password } = req.body;
    try {
      const stmt = db.prepare("INSERT INTO users (username, email, password) VALUES (?, ?, ?)");
      stmt.run(username, email, password);
      res.json({ success: true, username });
    } catch (err: any) {
      if (err.message.includes('UNIQUE constraint failed')) {
        res.status(400).json({ error: "Username or email already exists" });
      } else {
        res.status(500).json({ error: "Registration failed" });
      }
    }
  });

  app.post("/api/login", (req, res) => {
    const { loginId, password } = req.body;
    try {
      const stmt = db.prepare("SELECT * FROM users WHERE (username = ? OR email = ?) AND password = ?");
      const user = stmt.get(loginId, loginId, password);
      if (user) {
        res.json({ success: true, username: user.username });
      } else {
        res.status(401).json({ error: "Invalid credentials" });
      }
    } catch (err) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  // User presence tracking state and memory model
  interface ActiveUser {
    sessionId: string;
    username: string;
    lastSeen: number;
    isTyping: boolean;
    isBuffering: boolean;
    isMuted: boolean;
    isKicked: boolean;
    status: "waiting" | "approved";
  }
  const roomPresence = new Map<string, Map<string, ActiveUser>>();

  // Heartbeat endpoint to track user presence, typing status, buffering state, and handle lobby/kicks
  app.post("/api/room/:roomId/heartbeat", (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { username, sessionId, isTyping, isBuffering } = req.body;

    if (!username || !sessionId) {
      return res.status(400).json({ error: "Missing username or sessionId" });
    }

    let presenceMap = roomPresence.get(roomId);
    if (!presenceMap) {
      presenceMap = new Map();
      roomPresence.set(roomId, presenceMap);
    }

    const now = Date.now();
    const existing = presenceMap.get(sessionId);

    // If kicked, fast-fail the guest client
    if (existing && existing.isKicked) {
      return res.json({ success: true, kicked: true });
    }

    if (!existing) {
      // Check if lobby is enabled in this room
      let initialStatus: "waiting" | "approved" = "approved";
      try {
        const room = db.prepare("SELECT * FROM rooms WHERE room_id = ?").get(roomId);
        if (room) {
          if (room.is_lobby_enabled === 1 && room.host_session_id !== sessionId) {
            initialStatus = "waiting";
          }
        }
      } catch (err) {
        console.error("Lobby check failed:", err);
      }

      presenceMap.set(sessionId, {
        sessionId,
        username,
        lastSeen: now,
        isTyping: !!isTyping,
        isBuffering: !!isBuffering,
        isMuted: false,
        isKicked: false,
        status: initialStatus
      });

      // Insert "user entered the room" system message
      try {
        const stmt = db.prepare("INSERT INTO messages (room_id, username, message_text) VALUES (?, ?, ?)");
        stmt.run(roomId, "System", `${username} entered the room`);
      } catch (err) {
        console.error("Failed to insert system message for join:", err);
      }
    } else {
      existing.username = username;
      existing.lastSeen = now;
      existing.isTyping = !!isTyping;
      existing.isBuffering = !!isBuffering;
    }

    // Process expired heartbeats (users not seen in the last 30 seconds)
    const deadSessionIds: string[] = [];
    presenceMap.forEach((user, sessId) => {
      if (now - user.lastSeen > 30000) {
        deadSessionIds.push(sessId);
      }
    });

    deadSessionIds.forEach((sessId) => {
      const deadUser = presenceMap!.get(sessId);
      if (deadUser) {
        presenceMap!.delete(sessId);
        try {
          const stmt = db.prepare("INSERT INTO messages (room_id, username, message_text) VALUES (?, ?, ?)");
          stmt.run(roomId, "System", `${deadUser.username} has left the room`);
        } catch (err) {
          console.error("Failed to insert system message for timeout leave:", err);
        }
      }
    });

    // Collate details of other active users for the participant roster
    const activeUsersList: any[] = [];
    presenceMap.forEach((user) => {
      activeUsersList.push({
        sessionId: user.sessionId,
        username: user.username,
        isTyping: user.isTyping,
        isBuffering: user.isBuffering,
        isMuted: user.isMuted,
        status: user.status
      });
    });

    // Collate other users currently typing (excluding self, active in the last 10s)
    const typingUsers: string[] = [];
    presenceMap.forEach((user, sessId) => {
      if (sessId !== sessionId && user.isTyping && (now - user.lastSeen < 10000)) {
        typingUsers.push(user.username);
      }
    });

    res.json({ 
      success: true, 
      typingUsers, 
      activeUsers: activeUsersList,
      isMuted: existing ? existing.isMuted : false,
      status: existing ? existing.status : "approved"
    });
  });

  // Host moderation actions: approve, mute, kick, etc.
  app.post("/api/room/:roomId/moderation", (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { sessionId, targetSessionId, action } = req.body;

    try {
      const room = db.prepare("SELECT * FROM rooms WHERE room_id = ?").get(roomId);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      // Check if self is the host of this session
      if (room.host_session_id !== sessionId) {
        return res.status(403).json({ error: "Unauthorized. Host authority required." });
      }

      const presenceMap = roomPresence.get(roomId);
      if (!presenceMap) {
        return res.status(404).json({ error: "No active users in presence registry" });
      }

      const targetUser = presenceMap.get(targetSessionId);
      if (!targetUser) {
        return res.status(404).json({ error: "Target participant sessions not found" });
      }

      if (action === "mute") {
        targetUser.isMuted = true;
      } else if (action === "unmute") {
        targetUser.isMuted = false;
      } else if (action === "kick") {
        targetUser.isKicked = true;
        presenceMap.delete(targetSessionId);
        // Add kick log message
        const stmt = db.prepare("INSERT INTO messages (room_id, username, message_text) VALUES (?, ?, ?)");
        stmt.run(roomId, "System", `${targetUser.username} was kicked by the host`);
      } else if (action === "approve") {
        targetUser.status = "approved";
        // Log entry approval
        const stmt = db.prepare("INSERT INTO messages (room_id, username, message_text) VALUES (?, ?, ?)");
        stmt.run(roomId, "System", `${targetUser.username} registered with entry approval`);
      } else if (action === "deny") {
        targetUser.isKicked = true;
        presenceMap.delete(targetSessionId);
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Explicitly leaving a room (useful for window beforeunload / unmount)
  app.post("/api/room/:roomId/leave", (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }

    const presenceMap = roomPresence.get(roomId);
    if (presenceMap) {
      const user = presenceMap.get(sessionId);
      if (user) {
        presenceMap.delete(sessionId);
        try {
          const stmt = db.prepare("INSERT INTO messages (room_id, username, message_text) VALUES (?, ?, ?)");
          stmt.run(roomId, "System", `${user.username} has left the room`);
        } catch (err) {
          console.error("Failed to insert system message for leave route:", err);
        }
      }
    }

    res.json({ success: true });
  });

  // Helper for unique Room ID
  function generateRoomId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous chars like 1, I, 0, O
    let result = "";
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // Parse video URL to support YouTube and Google Drive
  function parseVideoUrl(url: string): string | null {
    if (!url) return null;
    const cleanUrl = url.trim();

    // Direct 11-char YouTube ID fallback
    if (/^[a-zA-Z0-9_-]{11}$/.test(cleanUrl)) {
      return cleanUrl;
    }

    // YouTube match (including Shorts, Live, embed, etc.)
    const ytMatch = cleanUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    if (ytMatch && ytMatch[1]) {
      return ytMatch[1];
    }
    
    // Google Drive match
    if (cleanUrl.includes("drive.google.com") || cleanUrl.includes("docs.google.com")) {
      const driveMatch1 = cleanUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (driveMatch1 && driveMatch1[1]) {
        return 'drive:' + driveMatch1[1];
      }
      const driveMatch2 = cleanUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      if (driveMatch2 && driveMatch2[1]) {
        return 'drive:' + driveMatch2[1];
      }
    }
    return null;
  }

  // API Routes
  
  // Streaming proxy for Google Drive Video
  const driveCache = new Map<string, { finalUrl: string, cookie: string, timestamp: number }>();

  app.get(["/api/proxy-video/:fileId", "/api/drive-proxy/:fileId"], async (req, res) => {
    const fileId = req.params.fileId;
    try {
      let cached = driveCache.get(fileId);
      
      // Expire cache after 1 hour (3600000 ms)
      if (cached && (Date.now() - cached.timestamp > 3600000)) {
        cached = undefined;
        driveCache.delete(fileId);
      }

      if (!cached) {
        const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
        const response = await fetch(url);
        
        let finalUrl = response.url;
        const cookie = response.headers.get("set-cookie") || "";
        const text = await response.text();
        
        const confirmMatch = text.match(/name="confirm" value="([^"]+)"/);
        const uuidMatch = text.match(/name="uuid" value="([^"]+)"/);
        
        if (confirmMatch && uuidMatch) {
           const parsedUrl = new URL(response.url);
           parsedUrl.searchParams.set("confirm", confirmMatch[1]);
           parsedUrl.searchParams.set("uuid", uuidMatch[1]);
           finalUrl = parsedUrl.toString();
        }

        cached = { finalUrl, cookie, timestamp: Date.now() };
        driveCache.set(fileId, cached);
      }

      const headers: Record<string, string> = {};
      if (req.headers.range) {
        headers["Range"] = req.headers.range;
      }
      if (cached.cookie) {
         headers["Cookie"] = cached.cookie;
      }
      
      // Use https to fetch and pipe
      const https = require("https");
      https.get(cached.finalUrl, { headers }, (videoResponse: any) => {
        if (videoResponse.statusCode === 206 || videoResponse.statusCode === 200) {
          res.status(videoResponse.statusCode);
          
          Object.keys(videoResponse.headers).forEach((key) => {
            const lowerKey = key.toLowerCase();
            // Do NOT forward CORP headers to allow cross-origin embedding, 
            // and do not forward keep-alive if our proxy manages it differently
            if (lowerKey !== 'cross-origin-resource-policy' && 
                lowerKey !== 'cross-origin-opener-policy' && 
                lowerKey !== 'cross-origin-embedder-policy' &&
                lowerKey !== 'connection' &&
                lowerKey !== 'keep-alive') {
              res.setHeader(key, videoResponse.headers[key]);
            }
          });
          
          videoResponse.pipe(res);
        } else {
          // If 403 or other error, clear cache so next try fetches fresh token
          if (videoResponse.statusCode >= 400 && videoResponse.statusCode < 500) {
             driveCache.delete(fileId);
          }
          res.status(videoResponse.statusCode).end();
        }
      }).on("error", (err: any) => {
        console.error("HTTPS stream error:", err);
        if (!res.headersSent) {
          res.status(500).end(`Error: ${err.message}`);
        }
      });
      
    } catch (err: any) {
      console.error("Error proxying Google Drive URL:", err.stack || err);
      if (!res.headersSent) {
        res.status(500).end(`Error: ${err.message}`);
      }
    }
  });

  // Resolve Google Drive Direct URL - Kept for legacy fallback or direct links if needed
  app.get("/api/drive-url/:fileId", async (req, res) => {
    const fileId = req.params.fileId;
    try {
      const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const response = await fetch(url);
      
      const text = await response.text();
      
      // Check for virus scan form
      const confirmMatch = text.match(/name="confirm" value="([^"]+)"/);
      const uuidMatch = text.match(/name="uuid" value="([^"]+)"/);
      
      if (confirmMatch && uuidMatch) {
         const confirm = confirmMatch[1];
         const uuid = uuidMatch[1];
         // We construct the final URL based on the response.url since fetch follows redirects
         const parsedUrl = new URL(response.url);
         parsedUrl.searchParams.set("confirm", confirm);
         parsedUrl.searchParams.set("uuid", uuid);
         
         res.json({ url: parsedUrl.toString() });
      } else {
         res.json({ url: response.url });
      }
    } catch (err) {
      console.error("Error resolving Google Drive URL:", err);
      res.json({ url: `https://drive.google.com/uc?export=download&id=${fileId}` });
    }
  });

  // Google Drive subtitle list fetcher
  app.get("/api/drive-subtitles-list/:fileId", async (req, res) => {
    const fileId = req.params.fileId;
    try {
      const url = `https://video.google.com/timedtext?v=${fileId}&type=list`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.json({ success: false, tracks: [] });
      }
      const xml = await response.text();
      
      const trackMatches = xml.match(/<track\s+[^>]+>/g) || [];
      const tracks = trackMatches.map((trackStr) => {
        const langCodeMatch = trackStr.match(/lang_code="([^"]+)"/);
        const nameMatch = trackStr.match(/name="([^"]*)"/);
        const langOriginalMatch = trackStr.match(/lang_original="([^"]*)"/);
        
        if (langCodeMatch) {
          return {
            lang: langCodeMatch[1],
            name: nameMatch ? nameMatch[1] : "",
            label: langOriginalMatch ? langOriginalMatch[1] : langCodeMatch[1]
          };
        }
        return null;
      }).filter((t): t is { lang: string; name: string; label: string } => t !== null);

      res.json({ success: true, tracks });
    } catch (err: any) {
      console.error("Error fetching drive subtitles list:", err);
      res.json({ success: false, tracks: [] });
    }
  });

  // Google Drive timedtext XML to WebVTT downloader & parser
  app.get("/api/drive-subtitles/:fileId/:lang", async (req, res) => {
    const { fileId, lang } = req.params;
    const name = req.query.name || "";
    try {
      // First try to fetch the timedtext API directly
      const url = `https://video.google.com/timedtext?v=${fileId}&lang=${lang}&name=${encodeURIComponent(name as string)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(404).send("Subtitles not found");
      }
      const xml = await response.text();
      
      if (xml.includes("<text")) {
        const textMatches = xml.match(/<text\s+[^>]+>[^<]*/g) || [];
        const cues: { start: number, end: number, text: string }[] = [];
        
        for (const textStr of textMatches) {
          const startMatch = textStr.match(/start="([\d.]+)"/);
          const durMatch = textStr.match(/dur="([\d.]+)"/);
          const contentMatch = textStr.match(/>([^<]*)/);
          
          if (startMatch) {
            const start = parseFloat(startMatch[1]);
            const dur = durMatch ? parseFloat(durMatch[1]) : 0;
            const text = contentMatch ? contentMatch[1] : "";
            
            // decode HTML/XML entities
            const decodedText = text
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&apos;/g, "'");

            cues.push({
              start,
              end: start + dur,
              text: decodedText
            });
          }
        }
        
        // Assemble WebVTT format
        let vtt = "WEBVTT\n\n";
        const formatVttTime = (seconds: number): string => {
          const h = Math.floor(seconds / 3600);
          const m = Math.floor((seconds % 3600) / 60);
          const s = Math.floor(seconds % 60);
          const ms = Math.floor((seconds % 1) * 1000);
          
          const pad = (n: number, size = 2) => String(n).padStart(size, "0");
          return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
        };
        
        cues.forEach((cue, index) => {
          vtt += `${index + 1}\n`;
          vtt += `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n`;
          vtt += `${cue.text}\n\n`;
        });
        
        res.setHeader("Content-Type", "text/vtt; charset=utf-8");
        res.send(vtt);
      } else {
        // Fallback to requesting Google's native auto-vtt parameter if available
        const directVttUrl = `https://video.google.com/timedtext?v=${fileId}&lang=${lang}&name=${encodeURIComponent(name as string)}&fmt=vtt`;
        const vttResponse = await fetch(directVttUrl);
        if (vttResponse.ok) {
          const vttText = await vttResponse.text();
          res.setHeader("Content-Type", "text/vtt; charset=utf-8");
          return res.send(vttText);
        }
        res.status(404).send("Subtitles format empty");
      }
    } catch (err: any) {
      console.error("Error downloading drive subtitle track:", err);
      res.status(500).send("Error converting subtitles");
    }
  });

  // Create Room with advanced configurations
  app.post("/api/create-room", async (req, res) => {
    const { videoUrl, hostSessionId, roomType, name, scheduledAt, onlyHostSync, isLobbyEnabled } = req.body;
    console.log(`Room creation requested for URL: ${videoUrl}`);
    
    const videoId = parseVideoUrl(videoUrl);

    if (!videoId) {
      console.warn("Invalid video URL provided");
      return res.status(400).json({ error: "Invalid URL. Please provide a standard YouTube or Google Drive link." });
    }

    const roomId = generateRoomId();
    
    try {
      const stmt = db.prepare(`
        INSERT INTO rooms (room_id, video_id, is_paused, host_session_id, room_type, name, scheduled_at, only_host_sync, is_lobby_enabled) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        roomId, 
        videoId, 
        1, 
        hostSessionId, 
        roomType || "EPHEMERAL", 
        name || `Room ${roomId}`, 
        scheduledAt || null, 
        onlyHostSync ? 1 : 0, 
        isLobbyEnabled ? 1 : 0
      );
      console.log(`Room created: ${roomId} (Type: ${roomType}, Video: ${videoId})`);
      res.json({ roomId });
    } catch (err) {
      console.error("Database error creating room", err);
      res.status(500).json({ error: "Fail-over: Database rejection during creation." });
    }
  });

  // Get Room Status including scheduling, permissions, breaks, etc.
  app.get("/api/room/:roomId/status", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    try {
      const stmt = db.prepare("SELECT * FROM rooms WHERE room_id = ?");
      const room = stmt.get(roomId);
      
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      res.json({
        videoId: room.video_id,
        currentTimestamp: room.current_timestamp,
        isPaused: room.is_paused === 1,
        hostSessionId: room.host_session_id,
        roomType: room.room_type,
        name: room.name,
        scheduledAt: room.scheduled_at,
        isLobbyEnabled: room.is_lobby_enabled === 1,
        onlyHostSync: room.only_host_sync === 1,
        breakEndTime: room.break_end_timestamp,
        videoQueue: JSON.parse(room.video_queue || "[]")
      });
    } catch (err) {
      console.error(`Database error fetching room ${roomId}`, err);
      res.status(500).json({ error: "Database retrieval failure." });
    }
  });

  // Update Room Status & host settings
  app.post("/api/room/:roomId/update", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { 
      currentTimestamp, 
      isPaused, 
      sessionId, 
      videoId,
      name,
      roomType,
      scheduledAt,
      isLobbyEnabled,
      onlyHostSync,
      breakEndTime
    } = req.body;

    try {
      const stmt = db.prepare("SELECT * FROM rooms WHERE room_id = ?");
      const room = stmt.get(roomId);
      
      if (!room) {
        // Recover room if the server restarted (ephemeral storage on Render)
        if (videoId && sessionId) {
           const insertStmt = db.prepare(`
             INSERT INTO rooms (room_id, video_id, current_timestamp, is_paused, host_session_id, room_type, name, only_host_sync, is_lobby_enabled) 
             VALUES (?, ?, ?, ?, ?, 'EPHEMERAL', 'Recovered Room', 0, 0)
           `);
           insertStmt.run(roomId, videoId, currentTimestamp, isPaused ? 1 : 0, sessionId);
           return res.json({ success: true, recovered: true });
        }
        return res.status(404).json({ error: "Room not found" });
      }

      // Check if trying to update host-only settings or regular state
      const isRoomHost = room.host_session_id === sessionId;
      
      // If the permission is set to "only host can sync", block updates if not host
      if (room.only_host_sync === 1 && !isRoomHost && (currentTimestamp !== undefined || isPaused !== undefined)) {
        return res.status(403).json({ error: "Playback controls locked to Host only." });
      }

      // Otherwise generic guests can sync unless only_host_sync is enabled
      // If updating room settings, MUST be host
      if ((isLobbyEnabled !== undefined || onlyHostSync !== undefined || breakEndTime !== undefined || roomType !== undefined || name !== undefined) && !isRoomHost) {
        return res.status(403).json({ error: "Settings modification requires Host authority." });
      }

      // Build safe granular update statement
      const updatedTimestamp = currentTimestamp !== undefined ? currentTimestamp : room.current_timestamp;
      const updatedIsPaused = isPaused !== undefined ? (isPaused ? 1 : 0) : room.is_paused;
      const updatedLobby = isLobbyEnabled !== undefined ? (isLobbyEnabled ? 1 : 0) : room.is_lobby_enabled;
      const updatedHostSync = onlyHostSync !== undefined ? (onlyHostSync ? 1 : 0) : room.only_host_sync;
      const updatedBreak = breakEndTime !== undefined ? breakEndTime : room.break_end_timestamp;
      const updatedName = name !== undefined ? name : room.name;
      const updatedRoomType = roomType !== undefined ? roomType : room.room_type;
      const updatedScheduled = scheduledAt !== undefined ? scheduledAt : room.scheduled_at;

      const updateStmt = db.prepare(`
        UPDATE rooms 
        SET current_timestamp = ?, is_paused = ?, is_lobby_enabled = ?, only_host_sync = ?, break_end_timestamp = ?, name = ?, room_type = ?, scheduled_at = ?
        WHERE room_id = ?
      `);
      updateStmt.run(
        updatedTimestamp, 
        updatedIsPaused, 
        updatedLobby, 
        updatedHostSync, 
        updatedBreak, 
        updatedName, 
        updatedRoomType, 
        updatedScheduled,
        roomId
      );

      res.json({ success: true });
    } catch (err: any) {
      console.error("Update status fail:", err);
      res.status(500).json({ error: "Update failure" });
    }
  });

  // Change Video (Host Only or if allowed)
  app.post("/api/room/:roomId/change-video", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { videoUrl, sessionId } = req.body;

    const videoId = parseVideoUrl(videoUrl);

    if (!videoId) {
      return res.status(400).json({ error: "Invalid YouTube or Google Drive URL." });
    }

    try {
      const stmt = db.prepare("SELECT * FROM rooms WHERE room_id = ?");
      const room = stmt.get(roomId);
      
      if (!room) {
        // Recover room if it was lost
        if (sessionId) {
           const insertStmt = db.prepare("INSERT INTO rooms (room_id, video_id, current_timestamp, is_paused, host_session_id) VALUES (?, ?, 0, 1, ?)");
           insertStmt.run(roomId, videoId, sessionId);
           return res.json({ success: true, videoId, recovered: true });
        }
        return res.status(404).json({ error: "Room not found" });
      }

      if (room.host_session_id !== sessionId && room.only_host_sync === 1) {
        return res.status(403).json({ error: "Unauthorized. Playback controls restricted to host." });
      }

      const updateStmt = db.prepare("UPDATE rooms SET video_id = ?, current_timestamp = 0, is_paused = 1, break_end_timestamp = NULL WHERE room_id = ?");
      updateStmt.run(videoId, roomId);

      res.json({ success: true, videoId });
    } catch (err) {
      res.status(500).json({ error: "Failed to change video" });
    }
  });

  // Queue Video / Play Next
  app.post("/api/room/:roomId/queue/add", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { videoUrl, sessionId } = req.body;

    const videoId = parseVideoUrl(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: "Invalid YouTube or Google Drive URL." });
    }

    try {
      const stmt = db.prepare("SELECT * FROM rooms WHERE room_id = ?");
      const room = stmt.get(roomId);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      if (room.host_session_id !== sessionId && room.only_host_sync === 1) {
        return res.status(403).json({ error: "Unauthorized. Playback controls restricted to host." });
      }

      const queue = JSON.parse(room.video_queue || "[]");
      queue.push({ id: videoId, url: videoUrl, addedAt: Date.now() });

      const updateStmt = db.prepare("UPDATE rooms SET video_queue = ? WHERE room_id = ?");
      updateStmt.run(JSON.stringify(queue), roomId);

      // Insert system message notifying the chat
      try {
        const msgStmt = db.prepare("INSERT INTO messages (room_id, username, message_text) VALUES (?, 'System', ?)");
        const isDrive = videoId.startsWith("drive:");
        const nameType = isDrive ? "Google Drive Track" : "YouTube Video";
        msgStmt.run(roomId, `Queued: ${nameType} (${videoUrl})`);
      } catch (err) {
        console.error("Failed to post system message for queue add:", err);
      }

      res.json({ success: true, videoQueue: queue });
    } catch (err) {
      res.status(500).json({ error: "Failed to add to queue" });
    }
  });

  // Skip / Play Next from Queue
  app.post("/api/room/:roomId/queue/next", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { sessionId } = req.body;

    try {
      const stmt = db.prepare("SELECT * FROM rooms WHERE room_id = ?");
      const room = stmt.get(roomId);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      if (room.host_session_id !== sessionId && room.only_host_sync === 1) {
        return res.status(403).json({ error: "Unauthorized. Playback controls restricted to host." });
      }

      const queue = JSON.parse(room.video_queue || "[]");
      if (queue.length === 0) {
        return res.status(400).json({ error: "Queue is empty" });
      }

      const nextVideo = queue.shift();

      const updateStmt = db.prepare(`
        UPDATE rooms 
        SET video_id = ?, current_timestamp = 0, is_paused = 1, break_end_timestamp = NULL, video_queue = ? 
        WHERE room_id = ?
      `);
      updateStmt.run(nextVideo.id, JSON.stringify(queue), roomId);

      try {
        const msgStmt = db.prepare("INSERT INTO messages (room_id, username, message_text) VALUES (?, 'System', ?)");
        msgStmt.run(roomId, `Now playing from queue: ${nextVideo.url}`);
      } catch (err) {}

      res.json({ success: true, videoId: nextVideo.id, videoQueue: queue });
    } catch (err) {
      res.status(500).json({ error: "Failed to skip to next video" });
    }
  });

  // Update whole queue (Reorder or Remove)
  app.post("/api/room/:roomId/queue/update", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { videoQueue, sessionId } = req.body;

    try {
      const stmt = db.prepare("SELECT * FROM rooms WHERE room_id = ?");
      const room = stmt.get(roomId);
      if (!room) {
        return res.status(404).json({ error: "Room not found" });
      }

      if (room.host_session_id !== sessionId && room.only_host_sync === 1) {
        return res.status(403).json({ error: "Unauthorized. Playback controls restricted to host." });
      }

      const updateStmt = db.prepare("UPDATE rooms SET video_queue = ? WHERE room_id = ?");
      updateStmt.run(JSON.stringify(videoQueue), roomId);

      res.json({ success: true, videoQueue });
    } catch (err) {
      res.status(500).json({ error: "Failed to update queue" });
    }
  });

  // Continuous Playback Watchlist Histroy DB routes: Add recent room
  app.post("/api/user/recent-rooms/add", (req, res) => {
    const { username, roomId, videoId, lastTimestamp } = req.body;
    if (!username || !roomId) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    try {
      const stmt = db.prepare(`
        INSERT INTO user_recent_rooms (username, room_id, video_id, last_timestamp, last_visited)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(username, room_id) DO UPDATE SET
          video_id = COALESCE(excluded.video_id, user_recent_rooms.video_id),
          last_timestamp = COALESCE(excluded.last_timestamp, user_recent_rooms.last_timestamp),
          last_visited = CURRENT_TIMESTAMP
      `);
      stmt.run(username, roomId, videoId || null, lastTimestamp || 0);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get a user's recent watchlist rooms and saved rooms
  app.get("/api/user/:username/rooms", (req, res) => {
    const username = req.params.username;
    try {
      const stmt = db.prepare(`
        SELECT urr.id, urr.username, urr.room_id, urr.last_timestamp, urr.last_visited,
               r.video_id, r.room_type, r.name as room_name, r.scheduled_at, r.is_paused, r.only_host_sync
        FROM user_recent_rooms urr
        INNER JOIN rooms r ON urr.room_id = r.room_id
        WHERE urr.username = ?
        ORDER BY urr.last_visited DESC
      `);
      const list = stmt.all(username);
      res.json(list);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Add Emoji Reaction to individual Chat bubbles (Toggles on-click!)
  app.post("/api/message/:messageId/react", (req, res) => {
    const messageId = parseInt(req.params.messageId);
    const { username, emoji } = req.body;

    if (!username || !emoji || isNaN(messageId)) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      // Toggle reaction check
      const checkStmt = db.prepare("SELECT * FROM message_reactions WHERE message_id = ? AND username = ? AND emoji = ?");
      const existing = checkStmt.get(messageId, username, emoji);

      if (existing) {
        const deleteStmt = db.prepare("DELETE FROM message_reactions WHERE message_id = ? AND username = ? AND emoji = ?");
        deleteStmt.run(messageId, username, emoji);
        res.json({ success: true, status: "removed" });
      } else {
        const insertStmt = db.prepare("INSERT INTO message_reactions (message_id, username, emoji) VALUES (?, ?, ?)");
        insertStmt.run(messageId, username, emoji);
        res.json({ success: true, status: "added" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send Message (Checks mute status first!)
  app.post("/api/room/:roomId/messages", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { username, sessionId, messageText, replyToId } = req.body;

    // Check if user is muted in active roomPresence state
    const presenceMap = roomPresence.get(roomId);
    if (presenceMap && sessionId) {
      const user = presenceMap.get(sessionId);
      if (user && user.isMuted) {
        return res.status(403).json({ error: "Your messages have been muting by the room host." });
      }
    }

    try {
      const stmt = db.prepare("INSERT INTO messages (room_id, username, message_text, reply_to_id) VALUES (?, ?, ?, ?)");
      stmt.run(roomId, username, messageText, replyToId || null);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Message failure" });
    }
  });

  // Get Messages combined with nested emoji reactions list
  app.get("/api/room/:roomId/messages", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    try {
      const messages = db.prepare("SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp ASC").all(roomId);
      
      const reactions = db.prepare(`
        SELECT mr.* FROM message_reactions mr
        INNER JOIN messages m ON mr.message_id = m.id
        WHERE m.room_id = ?
      `).all(roomId);

      // Collate message reactions matching their parents
      messages.forEach((m: any) => {
        m.reactions = reactions
          .filter((mr: any) => mr.message_id === m.id)
          .map((mr: any) => ({
            username: mr.username,
            emoji: mr.emoji
          }));
      });

      res.json(messages);
    } catch (err) {
      console.error("Messages fetch fail:", err);
      res.status(500).json({ error: "Message retrieval failure" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
