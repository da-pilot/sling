/**
 * Creates a new event emitter instance
 * @param {string} moduleName - Name of the module for logging
 * @returns {Object} - Event emitter with on, off, emit methods
 */
export default function createEventEmitter(moduleName = 'Unknown') {
  const listeners = new Map();

  function on(event, callback) {
    if (!listeners.has(event)) {
      listeners.set(event, []);
    }
    listeners.get(event).push(callback);
  }

  function off(event, callback) {
    const callbacks = listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  function emit(event, data) {
    const callbacks = listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[${moduleName}] Error in event listener:`, error);
        }
      });
    }
  }

  function clearListeners(event = null) {
    if (event) {
      listeners.delete(event);
    } else {
      listeners.clear();
    }
  }

  function getListenerCount(event) {
    const callbacks = listeners.get(event);
    return callbacks ? callbacks.length : 0;
  }

  function getEvents() {
    return Array.from(listeners.keys());
  }

  return {
    on,
    off,
    emit,
    clearListeners,
    getListenerCount,
    getEvents,
  };
}