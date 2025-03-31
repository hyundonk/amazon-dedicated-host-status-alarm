const { CloudWatchClient, GetInsightRuleReportCommand } = require("@aws-sdk/client-cloudwatch");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

// Initialize clients
const cloudWatch = new CloudWatchClient({ region: process.env.AWS_REGION });
const sns = new SNSClient({ region: process.env.AWS_REGION });
      
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));
  
  // Parse the SNS message
  let message;
  if (event.Records && event.Records[0] && event.Records[0].Sns) {
    // This is an SNS notification
    try {
      // Try to parse as JSON first
      message = JSON.parse(event.Records[0].Sns.Message);
      console.log('Parsed SNS message as JSON:', JSON.stringify(message, null, 2));
    } catch (e) {
      // If parsing fails, treat it as a plain text message
      console.log('SNS message is not JSON, treating as plain text');
      message = {
        AlarmName: event.Records[0].Sns.Subject?.replace('ALARM: ', '').replace(' in ALARM', '') || 'Unknown',
        NewStateValue: 'ALARM',
        AlarmDescription: event.Records[0].Sns.Message || 'No description'
      };
    }
  } else if (event.detail) {
    // This is a direct EventBridge event
    message = event;
  } else {
    console.error('Unexpected event format');
    return { statusCode: 400, body: 'Unexpected event format' };
  }
  
  // Extract alarm details from the appropriate structure
  const alarmName = message.detail?.alarmName || message.AlarmName;
  const alarmDescription = message.detail?.configuration?.description || message.AlarmDescription;
  const newState = message.detail?.state?.value || message.NewStateValue;
  const ruleName = process.env.CONTRIBUTOR_INSIGHTS_RULE_NAME;
  

  if (newState === 'ALARM') {
    try {
      // Get top contributors from the rule
      const command = new GetInsightRuleReportCommand({
        RuleName: ruleName,
        StartTime: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        EndTime: new Date(),
        Period: 60,
        MaxContributorCount: 100
      });
      
      const insightResult = await cloudWatch.send(command);
      console.log('Insight result:', JSON.stringify(insightResult, null, 2));

      
      // Format the host IDs and their states
      let hostDetails = 'No problematic hosts found';
      if (insightResult.Contributors && insightResult.Contributors.length > 0) {
        hostDetails = 'Problematic Hosts:\n';
        for (let i = 0; i < insightResult.Contributors.length; i++) {
          const contributor = insightResult.Contributors[i];
          if (contributor.Keys && contributor.Keys.length > 0) {
            hostDetails += `- Host ID: ${contributor.Keys[0]}, Host Name: ${contributor.Keys[1]}, State: ${contributor.Keys[2]}\n`;
          }
        }
      }
      
      // Send enhanced notification
      const messageText = `
ALARM: ${alarmName}
State: ${newState}
Description: ${alarmDescription || 'No description'}

${hostDetails}

Time: ${new Date().toISOString()}
      `;
      
      // When sending the SNS notification, ensure the subject is valid
      const subject = `ALARM: ${alarmName} is in ${newState} state`;
      // Truncate the subject if it's too long (SNS limit is 100 characters)
      const truncatedSubject = subject.substring(0, 100);

      await sns.send(new PublishCommand({
        TopicArn: process.env.SNS_TOPIC_ARN,
        Subject: truncatedSubject,
        Message: messageText
      }));
      
      return { statusCode: 200, body: 'Notification sent successfully' };
    } catch (error) {
      console.error('Error:', error);
      return { statusCode: 500, body: JSON.stringify(error) };
    }
  } else {
    console.log(`Alarm ${alarmName} is in ${newState} state. No action needed.`);
    return { statusCode: 200, body: 'No action needed' };
  }
};
