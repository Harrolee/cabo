import UAParser from 'my-ua-parser';

// Stripe configuration
export const STRIPE_PUBLIC_KEY = import.meta.env.VITE_STRIPE_PUBLIC_KEY;

// Device detection
const parser = new UAParser();
const device = parser.getDevice();
export const isMobile = device.type === 'mobile' || device.type === 'tablet';

// Workout videos configuration
export const WORKOUT_VIDEOS = [
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/beachPushups-hd_2048_1080_25fps.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/hunyuan-beachParty1.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/piggyback-hd_1920_1080_24fps.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/beachKnees-hd_1920_1080_25fps.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/12889070_1080_1920_30fps.mp4", 
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/minimax-beachParty.mp4",
    type: "video/mp4"
  },
  {
    url: "https://storage.googleapis.com/cabo-446722-workout-videos/videos/showerFlirt-hd_1080_1920_25fps.mp4",
    type: "video/mp4"
  }
]; 