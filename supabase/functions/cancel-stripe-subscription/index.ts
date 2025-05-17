import { serve } from 'https://deno.land/std@0.177.0/http/server.ts' // Or latest stable version
    
// IMPORTANT: Set this environment variable in your Supabase project's Function settings
// It should be the full HTTP trigger URL of your Google Cloud Function
const GCF_URL = Deno.env.get('CANCEL_STRIPE_SUBSCRIPTION_GCF_URL')

serve(async (req) => {
  // 1. Handle CORS preflight requests
  // Supabase Edge Functions have built-in CORS support.
  // You can configure it via the `supabase/config.toml` or allow all for simplicity here
  // if the request is OPTIONS, it's a preflight request, return 200
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 
      'Access-Control-Allow-Origin': '*', // Or your specific frontend domain
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
     } })
  }

  if (!GCF_URL) {
    console.error('CANCEL_STRIPE_SUBSCRIPTION_GCF_URL environment variable is not set.')
    return new Response(JSON.stringify({ error: 'Configuration error: GCF URL not set.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // 2. Extract the Authorization header from the incoming request
    // Supabase passes this along from the client when using supabase.functions.invoke()
    const authorizationHeader = req.headers.get('Authorization')
    if (!authorizationHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing Authorization header' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 3. Forward the request to your Google Cloud Function
    // We make a new request to the GCF_URL.
    // We pass along the method, headers (including Authorization), and body.
    const gcfResponse = await fetch(GCF_URL, {
      method: req.method, // Should be 'POST' as per your GCF and client
      headers: {
        // Forward the original Authorization header
        'Authorization': authorizationHeader,
        // Forward other relevant headers, especially Content-Type if there's a body
        'Content-Type': req.headers.get('Content-Type') || 'application/json',
        // Add any other headers your GCF might specifically expect
      },
      // If your client sends a body to the Supabase function, pass it to the GCF
      // For 'cancel-stripe-subscription', the body might be empty or contain minimal info
      body: req.body ? req.body : null, 
    })

    // 4. Return the response from the GCF back to the client
    const responseData = await gcfResponse.text() // Use .json() if you know GCF always returns JSON
    
    // Ensure correct Content-Type header on the response from this Edge Function
    const responseHeaders = new Headers(gcfResponse.headers) // Copy headers from GCF response
    responseHeaders.set('Access-Control-Allow-Origin', '*') // Set CORS for the response to the client

    return new Response(responseData, {
      status: gcfResponse.status,
      headers: responseHeaders,
    })

  } catch (error) {
    console.error('Error proxying request to GCF:', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error while contacting GCF.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})