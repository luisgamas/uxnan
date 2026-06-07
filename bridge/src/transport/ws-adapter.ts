/**
 * Adapts a `ws` WebSocket to the {@link MessageIO} interface.
 */
import type { RawData, WebSocket } from 'ws';
import type { MessageIO } from './message-io.js';

export function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data as ArrayBuffer);
}

export function wsToMessageIO(ws: WebSocket): MessageIO {
  return {
    send: (bytes) => ws.send(bytes, { binary: true }),
    onMessage: (listener) => ws.on('message', (data: RawData) => listener(rawDataToBuffer(data))),
    onClose: (listener) => ws.on('close', () => listener()),
    close: () => ws.close(),
  };
}
