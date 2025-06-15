import { useState, useEffect } from 'react';

export const usePreviewManager = () => {
  const [previewImages, setPreviewImages] = useState([]);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);

  useEffect(() => {
    const images = import.meta.glob('/src/assets/mobile-intro/*.{png,jpg,jpeg,gif}', {
      eager: true,
      import: 'default'
    });
    
    // Convert to sorted array of image paths
    const sortedImages = Object.entries(images)
      .sort(([pathA], [pathB]) => {
        // Extract numbers from filenames for sorting
        const numA = parseInt(pathA.match(/(\d+)/)[0]);
        const numB = parseInt(pathB.match(/(\d+)/)[0]);
        return numA - numB;
      })
      .map(([_, value]) => value);

    setPreviewImages(sortedImages);
  }, []);

  const handlePreviewNavigation = (direction) => {
    if (direction === 'next') {
      setCurrentPreviewIndex((prev) => (prev + 1) % previewImages.length);
    } else {
      setCurrentPreviewIndex((prev) => 
        prev === 0 ? previewImages.length - 1 : prev - 1
      );
    }
  };

  return {
    previewImages,
    currentPreviewIndex,
    handlePreviewNavigation
  };
}; 