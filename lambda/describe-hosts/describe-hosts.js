const { EC2Client, DescribeHostsCommand } = require("@aws-sdk/client-ec2");

const ec2Client = new EC2Client();

exports.handler = async (event, context) => {
  try {
    const response = await ec2Client.send(new DescribeHostsCommand({}));
    
    if (response.Hosts) {
      // 1. Aggregate metrics (low cost)
      const metricLog = {
        _aws: {
          Timestamp: Date.now(),
          CloudWatchMetrics: [{
            Namespace: "DedicatedHosts",
            Dimensions: [], 
            Metrics: [
              { Name: "UnderAssessmentHostCount", Unit: "Count" },
              { Name: "PermanentFailureHostCount", Unit: "Count" },
              { Name: "ReleasedHostCount", Unit: "Count" },
              { Name: "ReleasedPermanentFailureHostCount", Unit: "Count" },
            ]
          }]
        },
        UnderAssessmentHostCount: 0,
        PermanentFailureHostCount: 0,
        ReleasedHostCount: 0,
        ReleasedPermanentFailureHostCount: 0,
        TotalHosts: response.Hosts.length,
        level: "INFO",
        message: "Host metrics collected",
      }; 

      // Count states for metrics
      response.Hosts.forEach(host => {
        switch(host.State) {
          case 'under-assessment':
            metricLog.UnderAssessmentHostCount++;
            break;
          case 'permanent-failure':
            metricLog.PermanentFailureHostCount++;
            break;
          case 'released':
            metricLog.ReleasedHostCount++;
            break;
          case 'released-permanent-failure':
            metricLog.ReleasedPermanentFailureHostCount++;
            break;
        }
      });

      // Log metric using JSON.stringify to maintain the structure
      console.log(JSON.stringify(metricLog));

      // 2. Log problematic hosts with flat structure
      const problematicHosts = response.Hosts.filter(host => 
        ['under-assessment', 'permanent-failure', 'released-permanent-failure', 'released'].includes(host.State)
      );

      if (problematicHosts.length > 0) {
        problematicHosts.forEach(host => {
          // Create a flat structure and stringify it
          const flatLog = JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "WARN",
            event_type: "PROBLEMATIC_HOST",
            message: "Problematic Host Detected",
            hostId: host.HostId,
	    hostName: host.Tags?.find(tag => tag.Key === 'Name')?.Value || 'Unnamed',
            hostState: host.State,
            availabilityZone: host.AvailabilityZone,
            instanceType: host.InstanceType,
            lastModifiedTime: host.LastModifiedTime ? host.LastModifiedTime.toISOString() : null,
            requestId: context.awsRequestId 
          });
          
          // Log the stringified flat structure
          process.stdout.write(flatLog + '\n');
        });
      }
    }
  } catch (error) {
    // Log errors in flat structure
    process.stdout.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      message: 'Error processing dedicated host status',
      error: error.message,
      stack: error.stack
    }) + '\n');
    throw error;
  }
}

