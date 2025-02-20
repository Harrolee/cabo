const QualityRunner = require('./index');
const path = require('path');

async function main() {
  try {
    // Get scenario file path from command line arguments
    const scenarioPath = process.argv[2];
    if (!scenarioPath) {
      console.error('Please provide a path to your scenarios.json file');
      console.error('Usage: npm run qualityTest /path/to/scenarios.json');
      process.exit(1);
    }

    // Convert relative path to absolute path
    const absolutePath = path.resolve(process.cwd(), scenarioPath);
    console.log(`Loading scenarios from: ${absolutePath}`);

    // Initialize the QualityRunner with path to scenarios file
    const runner = new QualityRunner(
      absolutePath,
      './output'
    );

    // Run the quality test
    const outputDir = await runner.run();
    console.log(`Quality test completed. Check results in: ${outputDir}`);
  } catch (error) {
    console.error('Error running quality test:', error);
    process.exit(1);
  }
}

main(); 