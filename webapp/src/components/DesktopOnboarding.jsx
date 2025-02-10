import React, { useState, useEffect } from 'react';

export function DesktopOnboarding({ handleInitialSubscribe }) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [previewImages, setPreviewImages] = useState([]);

  useEffect(() => {
    const desktopImages = import.meta.glob('/src/assets/preview-images/*.{png,jpg,jpeg,gif}', {
      eager: true,
      import: 'default'
    });

    const imageArray = Object.entries(desktopImages).map(([path, src]) => ({
      src,
      alt: `Preview ${path.split('/').pop().split('.')[0]}`
    }));

    setPreviewImages(imageArray);
  }, []);

  return (
    <div className="flex flex-col items-center">
      <div className="w-full max-w-2xl">
        <div className="relative rounded-lg overflow-hidden shadow-xl">
          {previewImages.length > 0 && (
            <img
              src={previewImages[currentImageIndex].src}
              alt={previewImages[currentImageIndex].alt}
              className="w-full h-auto"
            />
          )}
          <div className="absolute bottom-4 left-0 right-0">
            <div className="flex justify-center gap-2">
              {previewImages.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentImageIndex(index)}
                  className={`h-2 w-2 rounded-full transition-colors ${
                    currentImageIndex === index ? 'bg-white' : 'bg-white/40'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-8 text-center">
          <button
            onClick={handleInitialSubscribe}
            className="w-64 py-3 px-6 bg-indigo-600 text-white rounded-full text-lg font-semibold shadow-lg hover:bg-indigo-700 transition-colors"
          >
            Start Your Free Trial
          </button>
        </div>
      </div>
    </div>
  );
} 