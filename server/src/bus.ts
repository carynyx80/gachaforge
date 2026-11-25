import { EventEmitter } from 'node:events';
import type { WsMessage } from './types.js';

/** In-process pub/sub feeding the /ws broadcaster. */
export class Bus {
  private ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(0);
  }
  publish(msg: WsMessage): void {
    this.ee.emit('msg', msg);
  }
  subscribe(fn: (msg: WsMessage) => void): () => void {
    this.ee.on('msg', fn);
    return () => this.ee.off('msg', fn);
  }
}
