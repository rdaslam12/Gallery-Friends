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
      host_session_id TEXT
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
  `);

  try {
    db.prepare("SELECT reply_to_id FROM messages LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER;");
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
    username: string;
    lastSeen: number;
    isTyping: boolean;
  }
  const roomPresence = new Map<string, Map<string, ActiveUser>>();

  // Heartbeat endpoint to track user presence, typing status, and handle joins/leaves
  app.post("/api/room/:roomId/heartbeat", (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { username, sessionId, isTyping } = req.body;

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

    if (!existing) {
      presenceMap.set(sessionId, {
        username,
        lastSeen: now,
        isTyping: !!isTyping
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
    }

    // Process expired heartbeats (users not seen in the last 4.5 seconds)
    const deadSessionIds: string[] = [];
    presenceMap.forEach((user, sessId) => {
      if (now - user.lastSeen > 4500) {
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

    // Collate other users currently typing (excluding self, active in the last 4.5s)
    const typingUsers: string[] = [];
    presenceMap.forEach((user, sessId) => {
      if (sessId !== sessionId && user.isTyping && (now - user.lastSeen < 4500)) {
        typingUsers.push(user.username);
      }
    });

    res.json({ success: true, typingUsers });
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
    if (cleanUrl.includes("drive.google.com")) {
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

  app.get("/api/proxy-video/:fileId", async (req, res) => {
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

  // Create Room
  app.post("/api/create-room", async (req, res) => {
    const { videoUrl, hostSessionId } = req.body;
    console.log(`Room creation requested for URL: ${videoUrl}`);
    
    const videoId = parseVideoUrl(videoUrl);

    if (!videoId) {
      console.warn("Invalid video URL provided");
      return res.status(400).json({ error: "Invalid URL. Please provide a standard YouTube or Google Drive link." });
    }

    const roomId = generateRoomId();
    
    try {
      const stmt = db.prepare("INSERT INTO rooms (room_id, video_id, is_paused, host_session_id) VALUES (?, ?, ?, ?)");
      stmt.run(roomId, videoId, 1, hostSessionId);
      console.log(`Room created: ${roomId} (Video: ${videoId})`);
      res.json({ roomId });
    } catch (err) {
      console.error("Database error creating room", err);
      res.status(500).json({ error: "Fail-over: Database rejection during creation." });
    }
  });

  // Get Room Status
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
        hostSessionId: room.host_session_id
      });
    } catch (err) {
      console.error(`Database error fetching room ${roomId}`, err);
      res.status(500).json({ error: "Database retrieval failure." });
    }
  });

  // Update Room Status (Host Only usually, but we check session IDs)
  app.post("/api/room/:roomId/update", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { currentTimestamp, isPaused, sessionId, videoId } = req.body;

    try {
      const stmt = db.prepare("SELECT * FROM rooms WHERE room_id = ?");
      const room = stmt.get(roomId);
      
      if (!room) {
        // Recover room if the server restarted (ephemeral storage on Render)
        if (videoId && sessionId) {
           const insertStmt = db.prepare("INSERT INTO rooms (room_id, video_id, current_timestamp, is_paused, host_session_id) VALUES (?, ?, ?, ?, ?)");
           insertStmt.run(roomId, videoId, currentTimestamp, isPaused ? 1 : 0, sessionId);
           return res.json({ success: true, recovered: true });
        }
        return res.status(404).json({ error: "Room not found" });
      }

      // Only update if it's the host
      if (room.host_session_id !== sessionId) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const updateStmt = db.prepare("UPDATE rooms SET current_timestamp = ?, is_paused = ? WHERE room_id = ?");
      updateStmt.run(currentTimestamp, isPaused ? 1 : 0, roomId);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: "Update failure" });
    }
  });

  // Change Video (Host Only)
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

      if (room.host_session_id !== sessionId) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const updateStmt = db.prepare("UPDATE rooms SET video_id = ?, current_timestamp = 0, is_paused = 1 WHERE room_id = ?");
      updateStmt.run(videoId, roomId);

      res.json({ success: true, videoId });
    } catch (err) {
      res.status(500).json({ error: "Failed to change video" });
    }
  });

  // Send Message
  app.post("/api/room/:roomId/messages", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    const { username, messageText, replyToId } = req.body;

    try {
      const stmt = db.prepare("INSERT INTO messages (room_id, username, message_text, reply_to_id) VALUES (?, ?, ?, ?)");
      stmt.run(roomId, username, messageText, replyToId || null);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Message failure" });
    }
  });

  // Get Messages
  app.get("/api/room/:roomId/messages", async (req, res) => {
    const roomId = req.params.roomId.trim().toUpperCase();
    try {
      const stmt = db.prepare("SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp ASC");
      const messages = stmt.all(roomId);
      res.json(messages);
    } catch (err) {
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
