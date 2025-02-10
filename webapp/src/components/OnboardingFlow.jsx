import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSwipeable } from 'react-swipeable';
import { SignUpForm } from './SignUpForm';

export function OnboardingFlow({ handleInitialSubscribe, onSubscribe, isMobile }) {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [previewImages, setPreviewImages] = useState([]);
  const [showSwipeHint, setShowSwipeHint] = useState(true);
  const [showSignupForm, setShowSignupForm] = useState(false);

  useEffect(() => {
    if (isMobile) {
      // For mobile, load and sort numbered images
      const mobileImages = import.meta.glob('/src/assets/mobile-intro/*.{png,jpg,jpeg,gif}', {
        eager: true,
        import: 'default'
      });

      const sortedImages = Object.entries(mobileImages)
        .sort(([pathA], [pathB]) => {
          const numA = parseInt(pathA.match(/(\d+)/)?.[0] || '0');
          const numB = parseInt(pathB.match(/(\d+)/)?.[0] || '0');
          return numA - numB;
        })
        .map(([path, src]) => ({
          src,
          alt: `Preview ${path.split('/').pop().split('.')[0]}`
        }));

      setPreviewImages(sortedImages);
    } else {
      // For desktop, load preview images
      const desktopImages = import.meta.glob('/src/assets/preview-images/*.{png,jpg,jpeg,gif}', {
        eager: true,
        import: 'default'
      });

      const imageArray = Object.entries(desktopImages).map(([path, src]) => ({
        src,
        alt: `Preview ${path.split('/').pop().split('.')[0]}`
      }));

      setPreviewImages(imageArray);
    }
  }, [isMobile]);

  useEffect(() => {
    if (showSwipeHint) {
      const timer = setTimeout(() => setShowSwipeHint(false), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const nextImage = () => {
    setCurrentImageIndex((prev) => 
      prev === previewImages.length - 1 ? 0 : prev + 1
    );
  };

  const prevImage = () => {
    setCurrentImageIndex((prev) => 
      prev === 0 ? previewImages.length - 1 : prev - 1
    );
  };

  const handlers = useSwipeable({
    onSwipedLeft: nextImage,
    onSwipedRight: prevImage,
    preventDefaultTouchmoveEvent: true,
    trackMouse: true
  });

  if (!isMobile) {
    if (showSignupForm) {
      return <SignUpForm onSubscribe={onSubscribe} />;
    }

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
              onClick={() => setShowSignupForm(true)}
              className="w-64 py-3 px-6 bg-indigo-600 text-white rounded-full text-lg font-semibold shadow-lg hover:bg-indigo-700 transition-colors"
            >
              Start Your Free Trial
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
      <AnimatePresence initial={false}>
        {previewImages.length > 0 && (
          <motion.div
            key={currentImageIndex}
            initial={{ opacity: 0, x: 300 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -300 }}
            transition={{ duration: 0.3 }}
            className="h-full w-full relative"
            {...handlers}
          >
            {currentImageIndex === previewImages.length - 1 ? (
              <div className="h-full w-full flex flex-col items-center justify-center p-6 text-white">
                <h2 className="text-3xl font-bold mb-4 text-center">
                  Ready to transform your fitness journey?
                </h2>
                <p className="text-lg mb-8 text-center">
                  Get started with your free trial today
                </p>
                <button
                  onClick={handleInitialSubscribe}
                  className="w-64 py-3 px-6 bg-indigo-600 rounded-full text-lg font-semibold shadow-lg"
                >
                  I'm in!
                </button>
              </div>
            ) : (
              <img
                src={previewImages[currentImageIndex].src}
                alt={previewImages[currentImageIndex].alt}
                className="h-full w-full object-cover"
              />
            )}

            {showSwipeHint && currentImageIndex === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center pointer-events-none"
              >
                <div className="flex items-center space-x-4">
                  <motion.div
                    animate={{ 
                      x: [-20, 20, -20],
                      opacity: [0.8, 1, 0.8]
                    }}
                    transition={{ 
                      duration: 1.5, 
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className="flex items-center"
                  >
                    <span className="text-white text-xl">Swipe</span>
                    <svg 
                      className="w-8 h-8 text-white ml-2" 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M14 5l7 7m0 0l-7 7m7-7H3" 
                      />
                    </svg>
                  </motion.div>
                </div>
              </motion.div>
            )}

            <div className="absolute bottom-8 left-0 right-0">
              <div className="flex justify-center gap-2">
                {[...Array(previewImages.length)].map((_, index) => (
                  <div
                    key={index}
                    className={`h-2 w-2 rounded-full ${
                      currentImageIndex === index ? 'bg-white' : 'bg-white/40'
                    }`}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
} 