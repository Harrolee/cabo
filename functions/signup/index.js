const cors = require('cors')({
  origin: process.env.ALLOWED_ORIGINS.split(','),
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
});
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const getSupabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handleSignup = (req, res) => {
  // Log incoming request details
  console.log('Incoming request:', {
    method: req.method,
    headers: req.headers,
    origin: req.headers.origin,
    allowedOrigins: process.env.ALLOWED_ORIGINS.split(',')
  });

  return cors(req, res, async () => {
    // Log that we passed CORS middleware
    console.log('Passed CORS middleware');

    if (req.method === 'OPTIONS') {
      console.log('Handling OPTIONS request');
      return res.status(204).send();
    }

    try {
      const { phone, name } = req.body;
      console.log('Processing signup request for:', { name, phone: phone?.slice(-4) }); // Log last 4 digits only for privacy
      
      if (!phone || !name) {
        console.log('Validation failed: missing phone or name');
        return res.status(400).json({
          success: false,
          message: 'Phone and name are required'
        });
      }

      const supabase = getSupabase();
      console.log('Attempting Supabase insert');

      const { error } = await supabase
        .from('user_profiles')
        .insert([{ phone, name }]);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      console.log('Signup successful');
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