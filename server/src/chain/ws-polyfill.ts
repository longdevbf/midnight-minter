import { WebSocket } from 'ws';

// SDK ví dùng WebSocket toàn cục; Node 22 chưa có bản tương thích cho GraphQL subscription.
(globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocket;
