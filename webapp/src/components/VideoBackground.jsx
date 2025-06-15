import React, { memo } from 'react';

export const VideoBackground = memo(function VideoBackground({ 
  currentVideoRef, 
  nextVideoRef, 
  currentVideoIndex, 
  nextVideoIndex, 
  handleVideoEnded,
  WORKOUT_VIDEOS,
  videosReady = true
}) {
  return (
    <>
      <video
        ref={currentVideoRef}
        key={`current-${currentVideoIndex}`}
        autoPlay
        muted
        preload="auto"
        playsInline
                onEnded={handleVideoEnded}
        className="absolute top-0 left-0 w-full h-full object-cover transition-opacity duration-1000"
      >
        <source
          src={WORKOUT_VIDEOS[currentVideoIndex].url}
          type={WORKOUT_VIDEOS[currentVideoIndex].type}
        />
      </video>

      <video
        ref={nextVideoRef}
        key={`next-${nextVideoIndex}`}
        muted
        preload="auto"
                playsInline
        className="absolute top-0 left-0 w-full h-full object-cover opacity-0 transition-opacity duration-1000"
      >
        <source
          src={WORKOUT_VIDEOS[nextVideoIndex].url}
          type={WORKOUT_VIDEOS[nextVideoIndex].type}
        />
      </video>



      {/* Initial loading indicator */}
      {!videosReady && (
        <div className="absolute inset-0 bg-black flex items-center justify-center z-20">
          <div className="text-center text-white">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-white mb-4"></div>
            <p className="text-lg">Loading videos...</p>
            <p className="text-sm opacity-75 mt-2">Optimizing your experience</p>
          </div>
        </div>
      )}
    </>
  );
});