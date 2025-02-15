const { processUser, fetchActiveUsers } = require('./user-management');

exports.sendMotivationalImages = async (event, context) => {
  try {
    // Get all active users and their subscription status
    console.log('Starting to fetch active users');
    const users = await fetchActiveUsers();

    // Process each user individually
    await Promise.all(users.map(processUser));

    return {
      statusCode: 200,
      body: `Completed image generation and sending process for ${users.length} users`,
    };
  } catch (error) {
    console.error("Error in sendMotivationalImages:", error);
    return {
      statusCode: 500,
      body: `Error: ${error.message}`,
    };
  }
};
