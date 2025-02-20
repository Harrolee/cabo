// used as seeds for scenarios
export const negativeDescriptors = 
{
  "emotional_physical_states": [
    "sweating",
    "out of breath",
    "slumped over",
    "eyes closed",
    "head down",
    "heavy breathing",
    "yawning",
    "lying down",
    "sitting down",
    "leaning against wall",
    "slow moving",
    "eyes half closed",
    "head nodding",
    "motionless",
    "slouching",
    "sleeping"
  ],
  "mental_emotional_distress": [
    "shaking",
    "trembling",
    "looking down",
    "avoiding eye contact",
    "biting lip",
    "wringing hands",
    "fidgeting",
    "stepping back",
    "frozen still",
    "hunched shoulders",
    "wide eyes",
    "alone in corner",
    "standing apart",
    "small posture",
    "crossed arms",
    "looking away",
    "hiding face",
    "turned away"
  ],
  "physical_weakness": [
    "thin arms",
    "bent back",
    "shoulders forward",
    "shaking legs",
    "bent over",
    "head down",
    "arms hanging",
    "body bent",
    "thin frame",
    "small muscles",
    "rounded back",
    "large belly",
    "wide body",
    "sitting still",
    "neck bent"
  ],
  "facial_expressions": [
    "red cheeks",
    "open mouth breathing",
    "frowning",
    "wet forehead",
    "red face",
    "squinting eyes",
    "pained expression",
    "white face",
    "wet skin",
    "drooping eyes",
    "mouth open"
  ],
  "movement_patterns": [
    "slow walking",
    "heavy steps",
    "tripping",
    "swaying",
    "unstable walking",
    "feet dragging",
    "slow steps",
    "unsteady movement",
    "slow motion"
  ]
}

export const positiveDescriptors = {
  "emotional_physical_states": [
    "standing tall",
    "bright eyes",
    "head high",
    "shoulders back",
    "quick movements",
    "jumping",
    "running",
    "active stance",
    "smiling wide",
    "standing firm",
    "chest forward",
    "arms raised",
    "fist pumping",
    "dynamic pose",
    "upright posture"
  ],
  "mental_emotional_attitude": [
    "direct eye contact",
    "steady gaze",
    "straight back",
    "chin up",
    "strong stance",
    "firm footing",
    "balanced pose",
    "centered position",
    "focused eyes",
    "alert expression",
    "ready stance",
    "head forward",
    "shoulders squared",
    "open posture",
    "feet planted"
  ],
  "physical_strength": [
    "muscular build",
    "strong arms",
    "broad shoulders",
    "solid stance",
    "feet apart",
    "rooted stance",
    "powerful pose",
    "thick muscles",
    "wide stance",
    "athletic body",
    "defined muscles",
    "standing straight",
    "strong legs",
    "stable position",
    "healthy glow",
    "energetic movement"
  ],
  "facial_expressions": [
    "intense gaze",
    "firm jaw",
    "focused eyes",
    "concentrated look",
    "calm face",
    "steady eyes",
    "measured breath",
    "alert eyes",
    "unwavering gaze",
    "strong jawline",
    "relaxed face",
    "glowing skin",
    "bright smile",
    "clear eyes",
    "determined look"
  ],
  "movement_patterns": [
    "smooth motion",
    "exact steps",
    "balanced walk",
    "flowing movement",
    "perfect form",
    "stable movement",
    "quick steps",
    "fast running",
    "purposeful stride",
    "strong steps",
    "clean form",
    "perfect balance",
    "flowing motion"
  ]
}


const actions = [
  "playing beach volleyball",
  "surfing the waves",
  "dancing on shoreline",
  "sipping tropical cocktails",
  "building sandcastles",
  "playing beach frisbee",
  "swimming in ocean",
  "beach picnic",
  "paddleboarding",
  "eating ice cream",
  "playing beach soccer",
  "sunbathing"
];

export const afterPrompts = [
  // Beach volleyball (3)
  "person with muscular build and strong arms playing beach volleyball, athletic body, powerful pose, intense gaze, perfect form",
  "person with broad shoulders playing beach volleyball, standing tall, direct eye contact, energetic movement, bright smile",
  "person playing beach volleyball with strong stance, feet planted, quick movements, focused eyes, smooth motion",
  
  // Surfing (3)
  "person with defined muscles surfing the waves, balanced pose, steady gaze, flowing movement, stable position",
  "person surfing the waves with strong legs, rooted stance, unwavering gaze, perfect balance, glowing skin",
  "person with athletic body surfing the waves, dynamic pose, alert eyes, smooth motion, firm footing",
  
  // Dancing (3)
  "person dancing on shoreline with flowing movement, bright smile, shoulders back, quick movements, glowing skin",
  "person with energetic movement dancing on shoreline, upright posture, head high, smooth motion, bright eyes",
  "person dancing on shoreline with perfect form, strong stance, active stance, balanced walk, clear eyes",
  
  // Sipping cocktails (3)
  "person sipping tropical cocktails with relaxed face, standing tall, shoulders squared, stable position, calm face",
  "person with steady gaze sipping tropical cocktails, open posture, centered position, balanced pose, bright smile",
  "person sipping tropical cocktails with strong jawline, upright posture, firm footing, smooth motion, glowing skin",
  
  // Sandcastles (3)
  "person building sandcastles with focused eyes, strong stance, precise movements, stable position, determined look",
  "person with steady hands building sandcastles, centered position, intense gaze, perfect form, direct eye contact",
  "person building sandcastles with strong arms, balanced pose, alert expression, smooth motion, bright eyes",
  
  // Frisbee (3)
  "person playing beach frisbee with athletic body, powerful pose, quick movements, fast running, bright smile",
  "person with strong arms playing beach frisbee, dynamic pose, focused eyes, perfect balance, energetic movement",
  "person playing beach frisbee with broad shoulders, active stance, steady gaze, flowing movement, clear eyes",
  
  // Swimming (3)
  "person swimming in ocean with strong legs, smooth motion, determined look, perfect form, glowing skin",
  "person with defined muscles swimming in ocean, flowing movement, steady eyes, balanced pose, bright smile",
  "person swimming in ocean with athletic body, powerful pose, focused eyes, stable movement, energetic movement",
  
  // Picnic (3)
  "person at beach picnic with upright posture, bright smile, shoulders back, centered position, relaxed face",
  "person with steady gaze at beach picnic, open posture, balanced pose, smooth motion, glowing skin",
  "person at beach picnic with strong stance, direct eye contact, firm footing, stable position, bright eyes",
  
  // Paddleboarding (3)
  "person paddleboarding with strong arms, balanced pose, focused eyes, perfect form, stable movement",
  "person with athletic body paddleboarding, rooted stance, steady gaze, flowing movement, determined look",
  "person paddleboarding with powerful pose, firm footing, alert eyes, perfect balance, energetic movement",
  
  // Ice cream (3)
  "person eating ice cream with bright smile, standing tall, shoulders squared, smooth motion, glowing skin",
  "person with relaxed face eating ice cream, open posture, centered position, balanced pose, clear eyes",
  "person eating ice cream with upright posture, steady gaze, firm footing, stable position, bright eyes",
  
  // Soccer (3)
  "person playing beach soccer with strong legs, dynamic pose, quick movements, fast running, intense gaze",
  "person with athletic body playing beach soccer, powerful pose, focused eyes, perfect form, energetic movement",
  "person playing beach soccer with broad shoulders, active stance, steady gaze, flowing movement, determined look",
  
  // Sunbathing (3)
  "person sunbathing with relaxed face, balanced pose, smooth motion, stable position, glowing skin",
  "person with steady gaze sunbathing, open posture, centered position, perfect form, bright smile",
  "person sunbathing with strong stance, upright posture, firm footing, stable movement, clear eyes"
];

export const beforePrompts = [
  // Beach volleyball (3)
  "person with thin arms playing beach volleyball, rounded back, heavy breathing, red face, unsteady movement",
  "person with slouched posture playing beach volleyball, bent over, sweating, drooping eyes, slow motion",
  "person playing beach volleyball with shaking legs, shoulders forward, pained expression, tripping, mouth open",
  
  // Surfing (3)
  "person with weak muscles surfing the waves, hunched shoulders, wide eyes, unstable walking, wet skin",
  "person surfing the waves with bent back, trembling, looking down, swaying, open mouth breathing",
  "person with thin frame surfing the waves, arms hanging, red cheeks, feet dragging, head down",
  
  // Dancing (3)
  "person dancing on shoreline with small posture, crossed arms, frowning, heavy steps, slow moving",
  "person with rounded back dancing on shoreline, looking away, red face, unsteady movement, slouching",
  "person dancing on shoreline with shaking legs, avoiding eye contact, wet forehead, slow steps, head down",
  
  // Sipping cocktails (3)
  "person sipping tropical cocktails with bent back, hiding face, drooping eyes, sitting still, leaning against wall",
  "person with thin frame sipping tropical cocktails, wringing hands, white face, slow motion, shoulders forward",
  "person sipping tropical cocktails with hunched shoulders, standing apart, mouth open, unstable walking, head down",
  
  // Sandcastles (3)
  "person building sandcastles with thin arms, slouching, squinting eyes, slow moving, sitting down",
  "person with rounded back building sandcastles, looking down, red face, heavy steps, bent over",
  "person building sandcastles with shaking hands, small posture, pained expression, unsteady movement, sweating",
  
  // Frisbee (3)
  "person playing beach frisbee with bent back, heavy breathing, drooping eyes, tripping, arms hanging",
  "person with weak muscles playing beach frisbee, looking away, red cheeks, slow steps, shoulders forward",
  "person playing beach frisbee with thin frame, avoiding eye contact, wet forehead, swaying, head down",
  
  // Swimming (3)
  "person swimming in ocean with shaking legs, wide eyes, open mouth breathing, unstable walking, wet skin",
  "person with hunched shoulders swimming in ocean, looking down, red face, slow motion, heavy breathing",
  "person swimming in ocean with thin arms, standing apart, pained expression, feet dragging, slouching",
  
  // Picnic (3)
  "person at beach picnic with bent back, hiding face, drooping eyes, sitting still, leaning against wall",
  "person with rounded shoulders at beach picnic, wringing hands, frowning, slow moving, head down",
  "person at beach picnic with small posture, looking away, mouth open, heavy steps, shoulders forward",
  
  // Paddleboarding (3)
  "person paddleboarding with weak muscles, trembling, red face, unsteady movement, sweating",
  "person with bent back paddleboarding, wide eyes, wet forehead, swaying, heavy breathing",
  "person paddleboarding with thin frame, looking down, pained expression, slow motion, slouching",
  
  // Ice cream (3)
  "person eating ice cream with hunched shoulders, avoiding eye contact, drooping eyes, sitting still, red cheeks",
  "person with rounded back eating ice cream, wringing hands, white face, slow steps, head down",
  "person eating ice cream with small posture, looking away, mouth open, unstable walking, shoulders forward",
  
  // Soccer (3)
  "person playing beach soccer with shaking legs, heavy breathing, red face, tripping, arms hanging",
  "person with thin frame playing beach soccer, looking down, wet forehead, slow motion, bent over",
  "person playing beach soccer with weak muscles, standing apart, pained expression, feet dragging, slouching",
  
  // Sunbathing (3)
  "person sunbathing with bent back, hiding face, drooping eyes, lying down, motionless",
  "person with rounded shoulders sunbathing, looking away, red face, sitting still, head nodding",
  "person sunbathing with small posture, avoiding eye contact, squinting eyes, slow moving, eyes half closed"
];