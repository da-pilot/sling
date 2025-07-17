// tools/media-library/workers/background-service-worker.js
// Background Service Worker for Media Library Discovery and Scanning

const CACHE_NAME = 'media-library-background-v1';
let isRunning = false;
let currentState = null;

// Initialize the service worker
self.addEventListener('install', (event) => {
  console.log('[Background Service Worker] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Background Service Worker] Activating...');
  event.waitUntil(self.clients.claim());
});

// Handle messages from main thread
self.addEventListener('message', async (event) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'START_DISCOVERY':
      await startDiscovery(data);
      break;
    case 'STOP_DISCOVERY':
      await stopDiscovery();
      break;
    case 'GET_STATUS':
      await sendStatus(event.source);
      break;
    case 'PAUSE_DISCOVERY':
      await pauseDiscovery();
      break;
    case 'RESUME_DISCOVERY':
      await resumeDiscovery();
      break;
  }
});

// Start the discovery process
async function startDiscovery(config) {
  if (isRunning) {
    console.log('[Background Service Worker] Discovery already running');
    return;
  }
  
  console.log('[Background Service Worker] Starting discovery...');
  isRunning = true;
  currentState = {
    status: 'running',
    startTime: Date.now(),
    config,
    lastActivity: Date.now()
  };
  
  // Save state to IndexedDB
  await saveState();
  
  // Start the discovery loop
  discoveryLoop();
}

// Main discovery loop
async function discoveryLoop() {
  if (!isRunning) return;
  
  try {
    currentState.lastActivity = Date.now();
    await saveState();
    
    // Perform discovery work here
    await performDiscoveryWork();
    
    // Schedule next iteration
    setTimeout(discoveryLoop, 30000); // 30 second intervals
  } catch (error) {
    console.error('[Background Service Worker] Discovery error:', error);
    currentState.status = 'error';
    currentState.error = error.message;
    await saveState();
    isRunning = false;
  }
}

// Perform actual discovery work
async function performDiscoveryWork() {
  // This would contain the actual discovery logic
  // For now, just simulate work
  console.log('[Background Service Worker] Performing discovery work...');
  
  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Update progress
  currentState.lastActivity = Date.now();
  await saveState();
  
  // Notify main thread of progress
  await notifyMainThread('DISCOVERY_PROGRESS', {
    timestamp: Date.now(),
    status: 'working'
  });
}

// Stop discovery
async function stopDiscovery() {
  console.log('[Background Service Worker] Stopping discovery...');
  isRunning = false;
  currentState = {
    status: 'stopped',
    stopTime: Date.now()
  };
  await saveState();
}

// Pause discovery
async function pauseDiscovery() {
  console.log('[Background Service Worker] Pausing discovery...');
  isRunning = false;
  currentState.status = 'paused';
  await saveState();
}

// Resume discovery
async function resumeDiscovery() {
  if (currentState?.status === 'paused') {
    console.log('[Background Service Worker] Resuming discovery...');
    isRunning = true;
    currentState.status = 'running';
    await saveState();
    discoveryLoop();
  }
}

// Save state to IndexedDB
async function saveState() {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction(['backgroundState'], 'readwrite');
    const store = tx.objectStore('backgroundState');
    await store.put(currentState, 'discoveryState');
  } catch (error) {
    console.error('[Background Service Worker] Failed to save state:', error);
  }
}

// Load state from IndexedDB
async function loadState() {
  try {
    const db = await openIndexedDB();
    const tx = db.transaction(['backgroundState'], 'readonly');
    const store = tx.objectStore('backgroundState');
    const state = await store.get('discoveryState');
    return state || null;
  } catch (error) {
    console.error('[Background Service Worker] Failed to load state:', error);
    return null;
  }
}

// Open IndexedDB
async function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MediaLibraryBackground', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('backgroundState')) {
        db.createObjectStore('backgroundState');
      }
    };
  });
}

// Send status to main thread
async function sendStatus(client) {
  const status = {
    isRunning,
    currentState,
    timestamp: Date.now()
  };
  
  client.postMessage({
    type: 'BACKGROUND_STATUS',
    data: status
  });
}

// Notify main thread
async function notifyMainThread(type, data) {
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type,
      data,
      timestamp: Date.now()
    });
  });
}

// Handle periodic cleanup and health checks
setInterval(async () => {
  if (isRunning && currentState) {
    const now = Date.now();
    const timeSinceLastActivity = now - currentState.lastActivity;
    
    // If no activity for 5 minutes, mark as idle
    if (timeSinceLastActivity > 300000) {
      currentState.status = 'idle';
      await saveState();
    }
  }
}, 60000); // Check every minute

// Handle service worker termination
self.addEventListener('beforeunload', async () => {
  if (isRunning) {
    currentState.status = 'terminated';
    await saveState();
  }
});

console.log('[Background Service Worker] Loaded and ready'); 