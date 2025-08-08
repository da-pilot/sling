export default function createCheckpointQueueManager() {
  const state = {
    updateQueue: [],
    processingLock: false,
  };
  function enqueueUpdate(update) {
    state.updateQueue.push(update);
  }
  function enqueueFolderDiscovery(folderData) {
    state.updateQueue.push({
      type: 'folderDiscovery',
      data: folderData,
      timestamp: Date.now(),
    });
  }
  function dequeueUpdate() {
    return state.updateQueue.shift();
  }
  function getQueueLength() {
    return state.updateQueue.length;
  }
  function clearQueue() {
    state.updateQueue = [];
  }
  function isProcessing() {
    return state.processingLock;
  }
  function setProcessingLock(locked) {
    state.processingLock = locked;
  }
  function getQueue() {
    return [...state.updateQueue];
  }
  function removeUpdate(updateId) {
    const index = state.updateQueue.findIndex((update) => update.id === updateId);
    if (index > -1) {
      state.updateQueue.splice(index, 1);
      return true;
    }
    return false;
  }

  return {
    enqueueUpdate,
    enqueueFolderDiscovery,
    dequeueUpdate,
    getQueueLength,
    clearQueue,
    isProcessing,
    setProcessingLock,
    getQueue,
    removeUpdate,
  };
}