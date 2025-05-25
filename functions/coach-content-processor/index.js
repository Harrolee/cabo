const { createClient } = require('@supabase/supabase-js');
const { Storage } = require('@google-cloud/storage');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fetch = require('node-fetch');
const { z } = require('zod');

// Initialize services
const storage = new Storage();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Validation schemas
const ProcessContentRequest = z.object({
  coachId: z.string().uuid(),
  fileDetails: z.object({
    name: z.string(),
    path: z.string(),
    type: z.string(),
    size: z.number()
  }),
  contentType: z.enum([
    'instagram_post',
    'video_transcript', 
    'podcast_transcript',
    'written_content',
    'social_media_comment',
    'blog_post'
  ])
});

/**
 * Extract text content from various file formats
 */
async function extractTextContent(buffer, mimeType, fileName) {
  const extension = fileName.split('.').pop().toLowerCase();
  
  try {
    switch (extension) {
      case 'txt':
      case 'md':
      case 'srt':
      case 'csv':
        return buffer.toString('utf-8');
        
      case 'json':
        const jsonData = JSON.parse(buffer.toString('utf-8'));
        // Handle Instagram export format
        if (jsonData.data && Array.isArray(jsonData.data)) {
          return jsonData.data.map(post => post.caption || '').join('\n\n');
        }
        return JSON.stringify(jsonData, null, 2);
        
      case 'pdf':
        const pdfData = await pdfParse(buffer);
        return pdfData.text;
        
      case 'docx':
        const docxResult = await mammoth.extractRawText({ buffer });
        return docxResult.value;
        
      case 'html':
        // Simple HTML text extraction (remove tags)
        return buffer.toString('utf-8').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        
      default:
        // Fallback to treating as text
        return buffer.toString('utf-8');
    }
  } catch (error) {
    console.error('Error extracting text:', error);
    throw new Error(`Failed to extract text from ${extension} file: ${error.message}`);
  }
}

/**
 * Analyze voice patterns in the content
 */
function analyzeVoicePatterns(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  
  // Analyze sentence structure
  const avgSentenceLength = sentences.reduce((sum, s) => sum + s.split(' ').length, 0) / sentences.length;
  const sentenceStructure = avgSentenceLength < 10 ? 'short_punchy' : 
                           avgSentenceLength > 20 ? 'long_explanatory' : 
                           'mixed_varied';
  
  // Analyze punctuation patterns
  const exclamationCount = (text.match(/!/g) || []).length;
  const questionCount = (text.match(/\?/g) || []).length;
  const emojiCount = (text.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length;
  
  const punctuationStyle = emojiCount > sentences.length * 0.3 ? 'emoji_heavy' :
                          exclamationCount > sentences.length * 0.3 ? 'exclamation_heavy' :
                          exclamationCount > sentences.length * 0.1 ? 'moderate' : 'minimal';
  
  // Analyze vocabulary level
  const casualWords = ['gonna', 'wanna', 'yeah', 'awesome', 'cool', 'super', 'totally'];
  const technicalWords = ['physiological', 'biomechanics', 'metabolic', 'cardiovascular', 'proprioception'];
  const motivationalWords = ['achieve', 'transform', 'powerful', 'unstoppable', 'breakthrough', 'conquer'];
  
  const casualCount = casualWords.reduce((count, word) => 
    count + (text.toLowerCase().includes(word) ? 1 : 0), 0);
  const technicalCount = technicalWords.reduce((count, word) => 
    count + (text.toLowerCase().includes(word) ? 1 : 0), 0);
  const motivationalCount = motivationalWords.reduce((count, word) => 
    count + (text.toLowerCase().includes(word) ? 1 : 0), 0);
  
  const vocabularyLevel = technicalCount > 2 ? 'technical' :
                         motivationalCount > 3 ? 'motivational' :
                         casualCount > 3 ? 'casual_slang' : 'professional';
  
  // Extract common sentence starters
  const sentenceStarters = sentences
    .map(s => s.trim().split(' ').slice(0, 3).join(' ').toLowerCase())
    .reduce((acc, starter) => {
      acc[starter] = (acc[starter] || 0) + 1;
      return acc;
    }, {});
  
  const commonStarters = Object.entries(sentenceStarters)
    .filter(([_, count]) => count > 1)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([starter]) => starter);
  
  // Extract potential catchphrases (repeated 2-4 word phrases)
  const phrases = [];
  for (let i = 0; i < words.length - 1; i++) {
    const twoWord = words.slice(i, i + 2).join(' ');
    const threeWord = words.slice(i, i + 3).join(' ');
    if (i < words.length - 2) phrases.push(threeWord);
    phrases.push(twoWord);
  }
  
  const phraseCounts = phrases.reduce((acc, phrase) => {
    if (phrase.length > 5) { // Only count meaningful phrases
      acc[phrase] = (acc[phrase] || 0) + 1;
    }
    return acc;
  }, {});
  
  const catchphrases = Object.entries(phraseCounts)
    .filter(([_, count]) => count > 2)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([phrase]) => phrase);
  
  // Calculate energy level (1-10)
  const energyIndicators = ['!', 'amazing', 'incredible', 'awesome', 'fantastic', 'yes', 'let\'s', 'come on'];
  const energyScore = Math.min(10, Math.max(1, 
    energyIndicators.reduce((score, indicator) => 
      score + (text.toLowerCase().split(indicator).length - 1), 0) / sentences.length * 10
  ));
  
  return {
    sentence_structure: sentenceStructure,
    punctuation_style: punctuationStyle,
    vocabulary_level: vocabularyLevel,
    typical_sentence_starters: commonStarters,
    catchphrases: catchphrases,
    energy_level: Math.round(energyScore),
    word_count: words.length,
    sentence_count: sentences.length,
    avg_sentence_length: Math.round(avgSentenceLength)
  };
}

/**
 * Extract intent tags from content
 */
function extractIntentTags(text, contentType) {
  const intentKeywords = {
    motivation: ['motivate', 'inspire', 'push', 'encourage', 'believe', 'achieve', 'goals'],
    advice: ['should', 'recommend', 'suggest', 'try', 'consider', 'remember', 'tip'],
    celebration: ['congratulations', 'amazing', 'proud', 'awesome', 'incredible', 'great job', 'well done'],
    education: ['learn', 'understand', 'explain', 'because', 'research', 'study', 'fact'],
    personal: ['i feel', 'my experience', 'when i', 'i remember', 'i struggled', 'i learned'],
    challenge: ['challenge', 'difficult', 'hard', 'struggle', 'obstacle', 'overcome', 'push through']
  };
  
  const tags = [];
  const lowercaseText = text.toLowerCase();
  
  Object.entries(intentKeywords).forEach(([intent, keywords]) => {
    const matches = keywords.filter(keyword => lowercaseText.includes(keyword));
    if (matches.length > 0) {
      tags.push(intent);
    }
  });
  
  // Add content-type specific tags
  if (contentType === 'instagram_post') tags.push('social_media');
  if (contentType === 'video_transcript') tags.push('visual_content');
  if (contentType === 'podcast_transcript') tags.push('audio_content');
  
  return tags;
}

/**
 * Extract situation tags from content
 */
function extractSituationTags(text) {
  const situationKeywords = {
    pre_workout: ['before workout', 'pre workout', 'getting ready', 'preparation'],
    post_workout: ['after workout', 'post workout', 'finished', 'completed'],
    struggling: ['struggling', 'difficult', 'hard time', 'can\'t do', 'giving up'],
    plateau: ['plateau', 'stuck', 'same weight', 'not progressing', 'no progress'],
    beginner: ['new to', 'starting out', 'first time', 'beginner', 'just started'],
    advanced: ['advanced', 'experienced', 'years of', 'expert level'],
    injury_recovery: ['injury', 'recovering', 'healing', 'hurt', 'pain', 'rehab']
  };
  
  const tags = [];
  const lowercaseText = text.toLowerCase();
  
  Object.entries(situationKeywords).forEach(([situation, keywords]) => {
    const matches = keywords.filter(keyword => lowercaseText.includes(keyword));
    if (matches.length > 0) {
      tags.push(situation);
    }
  });
  
  return tags;
}

/**
 * Main Cloud Function entry point
 */
exports.processCoachContent = async (req, res) => {
  try {
    // Validate request
    const requestData = ProcessContentRequest.parse(req.body);
    const { coachId, fileDetails, contentType } = requestData;
    
    console.log(`Processing content for coach ${coachId}: ${fileDetails.name}`);
    
    // Verify coach exists and user has permission
    const { data: coach, error: coachError } = await supabase
      .from('coach_profiles')
      .select('id, user_id')
      .eq('id', coachId)
      .single();
    
    if (coachError || !coach) {
      return res.status(404).json({ error: 'Coach not found' });
    }
    
    // Download file from GCP Storage
    const bucket = storage.bucket(process.env.GCP_STORAGE_BUCKET);
    const file = bucket.file(fileDetails.path);
    
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'File not found in storage' });
    }
    
    const [fileBuffer] = await file.download();
    
    // Extract text content
    console.log('Extracting text content...');
    const textContent = await extractTextContent(fileBuffer, fileDetails.type, fileDetails.name);
    
    if (!textContent || textContent.trim().length < 10) {
      return res.status(400).json({ error: 'No meaningful text content found in file' });
    }
    
    // Generate embeddings
    console.log('Generating embeddings...');
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: textContent.substring(0, 8000), // Limit to avoid token limits
    });
    
    // Analyze voice patterns
    console.log('Analyzing voice patterns...');
    const voicePatterns = analyzeVoicePatterns(textContent);
    
    // Extract tags
    const intentTags = extractIntentTags(textContent, contentType);
    const situationTags = extractSituationTags(textContent);
    
    // Determine if this is a good voice sample
    const isVoiceSample = textContent.length > 100 && 
                         (intentTags.includes('personal') || 
                          voicePatterns.catchphrases.length > 0);
    
    // Store in Supabase
    console.log('Storing content chunk...');
    const { data: contentChunk, error: insertError } = await supabase
      .from('coach_content_chunks')
      .insert({
        coach_id: coachId,
        content: textContent,
        content_type: contentType,
        source_url: null,
        file_name: fileDetails.name,
        file_path: fileDetails.path,
        intent_tags: intentTags,
        situation_tags: situationTags,
        emotional_need_tags: [], // Could be enhanced with sentiment analysis
        response_style_tags: [], // Could be enhanced with style classification
        voice_sample: isVoiceSample,
        sentence_structure: voicePatterns.sentence_structure,
        energy_level: voicePatterns.energy_level,
        embedding: embeddingResponse.data[0].embedding,
        processed: true,
        word_count: voicePatterns.word_count,
        engagement_metrics: {}
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('Database insert error:', insertError);
      return res.status(500).json({ error: 'Failed to store content chunk' });
    }
    
    // Update coach voice patterns if this is a good sample
    if (isVoiceSample) {
      console.log('Updating coach voice patterns...');
      
      // Get existing coach data
      const { data: existingCoach } = await supabase
        .from('coach_profiles')
        .select('voice_patterns, catchphrases')
        .eq('id', coachId)
        .single();
      
      // Merge voice patterns
      const updatedVoicePatterns = {
        ...existingCoach?.voice_patterns,
        ...voicePatterns,
        samples_processed: (existingCoach?.voice_patterns?.samples_processed || 0) + 1
      };
      
      // Merge catchphrases
      const existingCatchphrases = existingCoach?.catchphrases || [];
      const newCatchphrases = [...new Set([...existingCatchphrases, ...voicePatterns.catchphrases])];
      
      await supabase
        .from('coach_profiles')
        .update({
          voice_patterns: updatedVoicePatterns,
          catchphrases: newCatchphrases.slice(0, 10), // Limit to top 10
          total_content_pieces: (await supabase
            .from('coach_content_chunks')
            .select('id')
            .eq('coach_id', coachId)).data.length
        })
        .eq('id', coachId);
    }
    
    console.log(`Successfully processed content: ${contentChunk.id}`);
    
    res.json({
      success: true,
      contentChunkId: contentChunk.id,
      processed: true,
      voicePatterns: voicePatterns,
      isVoiceSample: isVoiceSample,
      wordCount: voicePatterns.word_count,
      intentTags: intentTags,
      situationTags: situationTags
    });
    
  } catch (error) {
    console.error('Content processing error:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: 'Invalid request data',
        details: error.errors 
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}; 