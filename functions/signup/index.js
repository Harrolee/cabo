const cors = require('cors')();
const { createClient } = require('@supabase/supabase-js');

// Shared CORS handling
const handleCors = (req, res) => {
  if (req.method === 'OPTIONS') {
    const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',');
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'POST');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '3600');
      res.status(204).send('');
      return true;
    }
  }
  return false;
};

// Initialize Supabase client
const getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handleSignup = (req, res) => {
  if (handleCors(req, res)) return;

  return cors(req, res, async () => {
    try {
      const { phone, name } = req.body;
      
      if (!phone || !name) {
        return res.status(400).json({
          success: false,
          message: 'Phone and name are required'
        });
      }

      const supabase = getSupabase();
      const { error } = await supabase
        .from('user_profiles')
        .insert([{ phone, name }]);

      if (error) throw error;

      res.status(200).json({ 
        success: true, 
        message: 'Successfully signed up!' 
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to sign up' 
      });
    }
  });
};

// exports.sendMotivationalImages = async (req, res) => {
//   if (handleCors(req, res)) return;

//   return cors(req, res, async () => {
//     try {
//       const supabase = getSupabase();
      
//       // Get all users
//       const { data: users, error: usersError } = await supabase
//         .from('user_profiles')
//         .select('*');

//       if (usersError) throw usersError;

//       // Process each user (existing motivation logic)
//       // ...

//       res.status(200).json({ 
//         success: true, 
//         message: 'Motivational messages sent successfully' 
//       });
//     } catch (error) {
//       console.error('Motivation sending error:', error);
//       res.status(500).json({ 
//         success: false, 
//         message: 'Failed to send motivational messages' 
//       });
//     }
//   });
// }; 