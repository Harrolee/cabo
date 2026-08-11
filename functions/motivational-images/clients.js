/**
 * Lazily-constructed service clients.
 *
 * They used to be built at module load, which meant requiring any file in this
 * function needed a full set of live credentials — impossible to exercise the
 * pipeline in a probe, and a cold-start cost even on runs where nobody is due.
 * Both the `require` and the construction are deferred, and every entry point
 * takes an optional `deps` object, so a test can hand in fakes for the four
 * services it has no credentials for.
 */

let supabase;
let storage;
let openai;
let replicate;
let twilio;

function getSupabase() {
  if (!supabase) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return supabase;
}

function getStorage() {
  if (!storage) {
    const { Storage } = require('@google-cloud/storage');
    storage = new Storage();
  }
  return storage;
}

function getOpenAI() {
  if (!openai) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function getReplicate() {
  if (!replicate) {
    const Replicate = require('replicate');
    replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  }
  return replicate;
}

function getTwilio() {
  if (!twilio) {
    const { Twilio } = require('twilio');
    twilio = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilio;
}

/**
 * Fill in whatever the caller did not provide.
 *
 * Deliberately lazy per-key: handing in a fake Twilio must not also force a
 * real Storage client into existence.
 */
function resolveDeps(deps = {}) {
  return {
    get supabase() {
      return deps.supabase || getSupabase();
    },
    get storage() {
      return deps.storage || getStorage();
    },
    get openai() {
      return deps.openai || getOpenAI();
    },
    get replicate() {
      return deps.replicate || getReplicate();
    },
    get twilio() {
      return deps.twilio || getTwilio();
    },
  };
}

module.exports = {
  getSupabase,
  getStorage,
  getOpenAI,
  getReplicate,
  getTwilio,
  resolveDeps,
};
