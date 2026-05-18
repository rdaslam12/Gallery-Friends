import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";

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
  `);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", db: !!db });
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
    // YouTube match
    const ytMatch = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch && ytMatch[1]) {
      return ytMatch[1]; // keep original yt format for backward compat
    }
    
    // Google Drive match
    const driveMatch1 = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (driveMatch1 && driveMatch1[1]) {
      return 'drive:' + driveMatch1[1];
    }
    const driveMatch2 = url.match(/drive\.google\.com\/(?:open|uc)\?.*id=([a-zA-Z0-9_-]+)/);
    if (driveMatch2 && driveMatch2[1]) {
      return 'drive:' + driveMatch2[1];
    }
    return null;
  }

  // API Routes
  
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
    const { username, messageText } = req.body;

    try {
      const stmt = db.prepare("INSERT INTO messages (room_id, username, message_text) VALUES (?, ?, ?)");
      stmt.run(roomId, username, messageText);
      res.json({ success: true });
    } catch (err) {
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
