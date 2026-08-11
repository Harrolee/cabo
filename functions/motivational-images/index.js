/**
 * Daily image for members on the SMS channel.
 *
 * Cloud Scheduler hits this once a day (`trigger-daily-motivation`). App users
 * are handled by `coach-nudges` instead; `fetchActiveUsers` filters this job
 * down to `notification_channel = 'sms'` so nobody gets both.
 */

const { processUser, fetchActiveUsers } = require('./user-management');

exports.sendMotivationalImages = async (event, context) => {
  try {
    console.log('Starting to fetch active users');
    const users = await fetchActiveUsers();

    const results = await Promise.all(users.map((user) => processUser(user)));

    const tally = results.reduce((acc, result) => {
      const key = result?.sent ? `sent:${result.sent}` : `skipped:${result?.skipped || 'unknown'}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    console.log('Daily image run: %d considered %j', users.length, tally);

    return {
      statusCode: 200,
      body: `Completed image generation for ${users.length} users: ${JSON.stringify(tally)}`,
    };
  } catch (error) {
    console.error('Error in sendMotivationalImages:', error);
    return {
      statusCode: 500,
      body: `Error: ${error.message}`,
    };
  }
};
