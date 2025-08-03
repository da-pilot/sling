import { createEventEmitter } from '../../shared/index.js';

export default function createQueueEventEmitter() {
  const eventEmitter = createEventEmitter('Queue Manager');
  return eventEmitter;
}