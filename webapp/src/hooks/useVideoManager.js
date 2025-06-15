import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoPreloader } from '../utils/VideoPreloader';
import { ServiceWorkerManager } from '../utils/serviceWorkerManager';
import { WORKOUT_VIDEOS } from '../constants';

export const useVideoManager = () => {
  // Video management state
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [nextVideoIndex, setNextVideoIndex] = useState(1);
  const currentVideoRef = useRef(null);
  const nextVideoRef = useRef(null);
  const videoPreloader = useRef(new VideoPreloader(WORKOUT_VIDEOS));
  const [videosReady, setVideosReady] = useState(false);

  const handleVideoEnded = useCallback(() => {
    // Transition to next video
    if (nextVideoRef.current) {
      nextVideoRef.current.style.opacity = 1;
      nextVideoRef.current.play().catch(console.warn);
    }
    if (currentVideoRef.current) {
      currentVideoRef.current.style.opacity = 0;
    }

    const newCurrentIndex = nextVideoIndex;
    const newNextIndex = (nextVideoIndex + 1) % WORKOUT_VIDEOS.length;
    
    setCurrentVideoIndex(newCurrentIndex);
    setNextVideoIndex(newNextIndex);
    
    // Preload upcoming videos
    if (videosReady) {
      videoPreloader.current.preloadMultiple(newNextIndex, 3).catch(console.warn);
    }
  }, [nextVideoIndex, videosReady]);

  // Initialize video preloading and service worker
  useEffect(() => {
    let isInitialized = false;
    
    const initializeVideoSystem = async () => {
      if (isInitialized) return;
      isInitialized = true;
      
      try {
        // Register service worker for video caching
        await ServiceWorkerManager.registerServiceWorker(WORKOUT_VIDEOS.map(v => v.url));
        
        // Preload initial videos
        await videoPreloader.current.preloadMultiple(0, 3);
        setVideosReady(true);
      } catch (error) {
        console.warn('Video system initialization failed:', error);
        setVideosReady(true);
      }
    };

    initializeVideoSystem();
  }, []);

  // Update next video when index changes
  useEffect(() => {
    if (nextVideoRef.current && videosReady) {
      const preloadedVideo = videoPreloader.current.getPreloadedVideo(nextVideoIndex);
      if (preloadedVideo) {
        nextVideoRef.current.src = preloadedVideo.src;
        nextVideoRef.current.load();
      } else {
        nextVideoRef.current.load();
        videoPreloader.current.preloadVideo(nextVideoIndex);
      }
    }
  }, [nextVideoIndex, videosReady]);

  return {
    currentVideoIndex,
    nextVideoIndex,
    currentVideoRef,
    nextVideoRef,
    videosReady,
    handleVideoEnded,
    WORKOUT_VIDEOS
  };
}; 