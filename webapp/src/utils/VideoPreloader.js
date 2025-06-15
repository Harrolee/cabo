// Video preloader class for better caching and loading management
export class VideoPreloader {
  constructor(videos) {
    this.videos = videos;
    this.loadedVideos = new Map();
    this.loadingPromises = new Map();
    this.preloadedElements = new Map();
  }

  async preloadVideo(index) {
    if (this.loadedVideos.has(index)) {
      return this.loadedVideos.get(index);
    }

    if (this.loadingPromises.has(index)) {
      return this.loadingPromises.get(index);
    }

    const promise = new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      
      const handleCanPlayThrough = () => {
        video.removeEventListener('canplaythrough', handleCanPlayThrough);
        video.removeEventListener('error', handleError);
        this.loadedVideos.set(index, video);
        this.preloadedElements.set(index, video);
        resolve(video);
      };

      const handleError = (error) => {
        video.removeEventListener('canplaythrough', handleCanPlayThrough);
        video.removeEventListener('error', handleError);
        console.error(`Failed to preload video ${index}:`, error);
        reject(error);
      };

      video.addEventListener('canplaythrough', handleCanPlayThrough);
      video.addEventListener('error', handleError);
      
      // Set source and trigger loading
      video.src = this.videos[index].url;
      video.load();
    });

    this.loadingPromises.set(index, promise);
    return promise;
  }

  async preloadMultiple(startIndex, count = 3) {
    const promises = [];
    for (let i = 0; i < count; i++) {
      const index = (startIndex + i) % this.videos.length;
      promises.push(this.preloadVideo(index));
    }
    
    try {
      await Promise.allSettled(promises);
    } catch (error) {
      console.warn('Some videos failed to preload:', error);
    }
  }

  getPreloadedVideo(index) {
    return this.preloadedElements.get(index);
  }

  isVideoLoaded(index) {
    return this.loadedVideos.has(index);
  }
} 