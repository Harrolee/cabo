# Quality

A tool for generating and testing image pairs from scenario files. This tool helps validate and visualize the output of different image generation models using predefined scenarios.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
export REPLICATE_API_TOKEN=your_replicate_token_here
```

## Usage

The Quality package provides a `QualityRunner` class that generates image pairs based on scenario files. Each run creates a new directory with the current timestamp and organizes the generated images by theme.

### Basic Usage

```javascript
const QualityRunner = require('./index');

// Initialize with path to scenarios file and output directory
const runner = new QualityRunner(
  'path/to/scenarios.js',
  './output'
);

// Run the quality test
const outputDir = await runner.run();
```

### Output Structure

The tool creates a directory structure like this:

```
output/
  2025-02-19-14-30-00/
    info.json
    theme1/
      before_image_title.png
      after_image_title.png
    theme2/
      before_image_title.png
      after_image_title.png
    ...
```

- Each run creates a new directory with the current timestamp
- `info.json` contains metadata about the run, including models used and scenarios
- Each theme gets its own directory containing the before/after image pair
- Images are named according to their titles in the scenario file

### Example

You can run the included example script:

```bash
node example.js
```

## Scenarios File Format

The scenarios file should export an object with the following structure:

```javascript
{
  // Optional: Path to an image file or URL to use as the subject
  "subject_image_url": "./path/to/image.jpg", // or "https://example.com/image.jpg"
  
  // Optional: Weighted distribution for model selection (STYLE:REALISTIC:REALVIS:BACKUP)
  "model_split": "4:4:2:1",
  
  // Optional: Weighted distribution for PhotoMaker styles when STYLE model is selected
  "photomaker_style_split": {
    "Cinematic": 4,
    "Disney Charactor": 2,
    "Fantasy art": 3,
    "Enhance": 1,
    "Comic book": 2,
    "Line art": 1,
    "Digital Art": 3,
    "Neonpunk": 1,
    "Photographic": 2,
    "Lowpoly": 1
  },
  
  // Required: Array of scenario pairs to generate
  "scenario_pairs": [
    {
      "theme": "theme_name",
      "before": {
        "title": "Before Image Title",
        "prompt": "Prompt for generating before image",
        "negative_prompt": "Negative prompt for before image"
      },
      "after": {
        "title": "After Image Title",
        "prompt": "Prompt for generating after image",
        "negative_prompt": "Negative prompt for after image"
      }
    }
  ]
} 