export interface RoomStatus {
  videoId: string;
  currentTimestamp: number;
  isPaused: boolean;
  hostSessionId: string;
}

export interface ChatMessage {
  id: number;
  room_id: string;
  username: string;
  message_text: string;
  timestamp: string;
}
