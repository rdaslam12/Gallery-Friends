export interface RoomStatus {
  videoId: string;
  currentTimestamp: number;
  isPaused: boolean;
  hostSessionId: string;
  roomType?: string;
  name?: string;
  scheduledAt?: string;
  isLobbyEnabled?: boolean;
  onlyHostSync?: boolean;
  breakEndTime?: number | null;
}

export interface ChatMessage {
  id: number;
  room_id: string;
  username: string;
  message_text: string;
  timestamp: string;
  reply_to_id?: number | null;
  reactions?: { username: string; emoji: string }[];
}
