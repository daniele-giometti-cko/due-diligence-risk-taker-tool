using Amazon.Runtime.CredentialManagement;
using Amazon.SQS;
using Amazon.SQS.Model;
using DueDiligenceRiskTakerTool.Api.Models;

namespace DueDiligenceRiskTakerTool.Api.Services;

/// <summary>
/// SQS mode: list queues, send a crafted message, purge a queue.
/// Send/purge are MUTATING actions and may run against prod queues — the controller
/// enforces a typed-queue-name confirmation for purge. Never log message bodies or
/// attribute values (may contain Due Diligence domain data) — log queue names + ids only.
/// </summary>
public class SqsService
{
    private readonly IAmazonSQS _sqs;
    private readonly ILogger<SqsService> _logger;

    public SqsService(IAmazonSQS sqs, ILogger<SqsService> logger)
    {
        _sqs = sqs;
        _logger = logger;
    }

    public async Task<List<SqsQueue>> ListQueuesAsync(string? profile = null)
    {
        if (string.IsNullOrEmpty(profile))
            return await RunListAsync(_sqs);

        using var client = CreateClientForProfile(profile);
        return await RunListAsync(client);
    }

    private static async Task<List<SqsQueue>> RunListAsync(IAmazonSQS client)
    {
        var queues = new List<SqsQueue>();
        string? token = null;
        do
        {
            var resp = await client.ListQueuesAsync(new ListQueuesRequest { MaxResults = 1000, NextToken = token });
            foreach (var url in resp.QueueUrls)
            {
                var name = url.Split('/').Last();
                queues.Add(new SqsQueue { Url = url, Name = name, Fifo = name.EndsWith(".fifo") });
            }
            token = resp.NextToken;
        } while (!string.IsNullOrEmpty(token));

        return queues.OrderBy(q => q.Name).ToList();
    }

    public async Task<SqsSendResponse> SendMessageAsync(SqsSendRequest request)
    {
        using var client = string.IsNullOrEmpty(request.Profile) ? null : CreateClientForProfile(request.Profile);
        var sqs = client ?? _sqs;

        var sendRequest = new SendMessageRequest
        {
            QueueUrl = request.QueueUrl,
            MessageBody = request.Body,
        };

        if (request.MessageAttributes is { Count: > 0 })
        {
            sendRequest.MessageAttributes = request.MessageAttributes
                .Where(a => !string.IsNullOrWhiteSpace(a.Name))
                .ToDictionary(
                    a => a.Name,
                    a => new MessageAttributeValue
                    {
                        DataType = string.IsNullOrWhiteSpace(a.DataType) ? "String" : a.DataType,
                        StringValue = a.Value ?? string.Empty,
                    });
        }

        if (!string.IsNullOrWhiteSpace(request.MessageGroupId))
            sendRequest.MessageGroupId = request.MessageGroupId;
        if (!string.IsNullOrWhiteSpace(request.MessageDeduplicationId))
            sendRequest.MessageDeduplicationId = request.MessageDeduplicationId;

        var resp = await sqs.SendMessageAsync(sendRequest);
        _logger.LogInformation("SQS send to {Queue} → messageId {MessageId}",
            request.QueueUrl.Split('/').Last(), resp.MessageId);

        return new SqsSendResponse { MessageId = resp.MessageId, SequenceNumber = resp.SequenceNumber };
    }

    public async Task PurgeQueueAsync(string queueUrl, string? profile = null)
    {
        using var client = string.IsNullOrEmpty(profile) ? null : CreateClientForProfile(profile);
        var sqs = client ?? _sqs;

        await sqs.PurgeQueueAsync(new PurgeQueueRequest { QueueUrl = queueUrl });
        _logger.LogWarning("SQS PURGE issued for {Queue}", queueUrl.Split('/').Last());
    }

    // Short-lived client using a named AWS profile (region from ~/.aws/config; falls back to eu-west-1).
    private static AmazonSQSClient CreateClientForProfile(string profileName)
    {
        var chain = new CredentialProfileStoreChain();

        if (!chain.TryGetAWSCredentials(profileName, out var credentials))
            throw new InvalidOperationException(
                $"AWS profile '{profileName}' not found or has no usable credentials. " +
                "Check ~/.aws/credentials and ~/.aws/config.");

        chain.TryGetProfile(profileName, out var profile);
        var region = profile?.Region ?? Amazon.RegionEndpoint.EUWest1;

        return new AmazonSQSClient(credentials, region);
    }
}
