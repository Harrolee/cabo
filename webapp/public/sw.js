const CACHE_NAME = 'cabofit-videos-v1';
const VIDEO_CACHE_NAME = 'cabofit-videos-store-v1';

// Video URLs to cache
const WORKOUT_VIDEOS = [
  "https://storage.googleapis.com/cabo-446722-workout-videos/videos/beachPushups-hd_2048_1080_25fps.mp4",
  "https://storage.googleapis.com/cabo-446722-workout-videos/videos/hunyuan-beachParty1.mp4",
  "https://storage.googleapis.com/cabo-446722-workout-videos/videos/piggyback-hd_1920_1080_24fps.mp4",
  "https://storage.googleapis.com/cabo-446722-workout-videos/videos/beachKnees-hd_1920_1080_25fps.mp4",
  "https://storage.googleapis.com/cabo-446722-workout-videos/videos/12889070_1080_1920_30fps.mp4",
  "https://storage.googleapis.com/cabo-446722-workout-videos/videos/minimax-beachParty.mp4",
  "https://storage.googleapis.com/cabo-446722-workout-videos/videos/showerFlirt-hd_1080_1920_25fps.mp4"
];

// Install event - cache videos
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(VIDEO_CACHE_NAME).then((cache) => {
      console.log('Caching workout videos...');
      // Cache videos with longer expiration for better UX
      return Promise.allSettled(
        WORKOUT_VIDEOS.map(url => 
          cache.add(url).catch(error => {
            console.warn(`Failed to cache video: ${url}`, error);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== VIDEO_CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve cached videos or fetch from network
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Handle video requests specially
  if (WORKOUT_VIDEOS.some(videoUrl => url.includes(videoUrl.split('/').pop()))) {
    event.respondWith(
      caches.open(VIDEO_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            console.log('Serving video from cache:', url);
            return cachedResponse;
          }
          
          console.log('Fetching and caching video:', url);
          return fetch(event.request).then((response) => {
            // Cache the video response
            if (response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch((error) => {
            console.error('Failed to fetch video:', url, error);
            // Return a basic response to prevent complete failure
            return new Response('Video temporarily unavailable', { 
              status: 503, 
              statusText: 'Service Unavailable' 
            });
          });
        });
      })
    );
  }
  // For other requests, use default handling
  else if (event.request.destination === 'document' || event.request.destination === 'script' || event.request.destination === 'style') {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return response || fetch(event.request);
      })
    );
  }
});

// Message event - for communication with the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRELOAD_VIDEOS') {
    console.log('Received video preload request');
    caches.open(VIDEO_CACHE_NAME).then((cache) => {
      const urls = event.data.urls || WORKOUT_VIDEOS;
      return Promise.allSettled(
        urls.map(url => 
          cache.add(url).catch(error => {
            console.warn(`Failed to preload video: ${url}`, error);
          })
        )
      );
    });
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
}); 