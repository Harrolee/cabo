// Service worker management utilities
export class ServiceWorkerManager {
  static async registerServiceWorker(videoUrls = []) {
    if (!('serviceWorker' in navigator) || navigator.serviceWorker.controller) {
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      
      // Send message to preload videos
      if (registration.active && videoUrls.length > 0) {
        registration.active.postMessage({
          type: 'PRELOAD_VIDEOS',
          urls: videoUrls
        });
      }
      
      return registration;
    } catch (error) {
      console.warn('Service worker registration failed:', error);
      return null;
    }
  }
} 