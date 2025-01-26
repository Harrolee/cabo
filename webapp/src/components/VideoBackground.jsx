import React from 'react';

export function VideoBackground({ 
  currentVideoRef, 
  nextVideoRef, 
  currentVideoIndex, 
  nextVideoIndex, 
  handleVideoEnded,
  WORKOUT_VIDEOS 
}) {
  return (
    <>
      <video
        ref={currentVideoRef}
        key={`current-${currentVideoIndex}`}
        autoPlay
        muted
        preload="auto"
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
        className="absolute top-0 left-0 w-full h-full object-cover opacity-0 transition-opacity duration-1000"
      >
        <source
          src={WORKOUT_VIDEOS[nextVideoIndex].url}
          type={WORKOUT_VIDEOS[nextVideoIndex].type}
        />
      </video>
    </>
  );
} 