using Amazon.CloudWatchLogs;
using Amazon.CloudWatchLogs.Model;
using Amazon.ResourceGroupsTaggingAPI;
using Amazon.ResourceGroupsTaggingAPI.Model;
using Amazon.Runtime;
using Amazon.Runtime.CredentialManagement;
using DueDiligenceLogsTellerAgent.Api.Models;

namespace DueDiligenceLogsTellerAgent.Api.Services;

public class CloudWatchService
{
    private readonly IAmazonCloudWatchLogs _cloudWatch;

    public CloudWatchService(IAmazonCloudWatchLogs cloudWatch)
    {
        _cloudWatch = cloudWatch;
    }

    public async Task<List<string>> ListLogGroupsAsync(string? profile = null)
    {
        var (credentials, region) = string.IsNullOrEmpty(profile)
            ? (null, Amazon.RegionEndpoint.EUWest1)
            : ResolveProfile(profile);

        using var tagging = credentials is not null
            ? new AmazonResourceGroupsTaggingAPIClient(credentials, region)
            : new AmazonResourceGroupsTaggingAPIClient(region);

        var groups = new List<string>();
        string? paginationToken = null;

        do
        {
            var resp = await tagging.GetResourcesAsync(new GetResourcesRequest
            {
                TagFilters =
                [
                    new TagFilter { Key = "pillar", Values = ["operations-and-compliance-services"] },
                    new TagFilter { Key = "product", Values = ["duediligence"] }
                ],
                ResourceTypeFilters = ["logs:log-group"],
                PaginationToken = string.IsNullOrEmpty(paginationToken) ? null : paginationToken
            });

            groups.AddRange(resp.ResourceTagMappingList
                .Select(r => r.ResourceARN.Split(":log-group:").Last()));

            paginationToken = resp.PaginationToken;
        }
        while (!string.IsNullOrEmpty(paginationToken));

        return [.. groups.OrderBy(g => g)];
    }

    public async Task<CloudWatchQueryResult> RunQueryAsync(CloudWatchQuery query)
    {
        var client = string.IsNullOrEmpty(query.Profile) ? _cloudWatch : CreateClientForProfile(query.Profile);
        try
        {
            return await ExecuteQueryAsync(client, query);
        }
        finally
        {
            if (!ReferenceEquals(client, _cloudWatch))
                client.Dispose();
        }
    }

    private static async Task<CloudWatchQueryResult> ExecuteQueryAsync(IAmazonCloudWatchLogs client, CloudWatchQuery query)
    {
        var now = DateTimeOffset.UtcNow;
        var start = now.AddHours(-query.LookbackHours);

        var startResp = await client.StartQueryAsync(new StartQueryRequest
        {
            LogGroupName = query.LogGroupName,
            QueryString = query.QueryString,
            StartTime = start.ToUnixTimeSeconds(),
            EndTime = now.ToUnixTimeSeconds()
        });

        // Poll until CloudWatch finishes the async query (typically 1–5 s).
        var queryId = startResp.QueryId;
        GetQueryResultsResponse results;
        var deadline = DateTime.UtcNow.AddSeconds(30);

        do
        {
            await Task.Delay(500);
            results = await client.GetQueryResultsAsync(new GetQueryResultsRequest { QueryId = queryId });
        }
        while (results.Status == QueryStatus.Running && DateTime.UtcNow < deadline);

        var items = results.Results.Select(row =>
            row.ToDictionary(f => f.Field, f => (object?)f.Value)
        ).ToList();

        return new CloudWatchQueryResult
        {
            Items = items,
            Count = items.Count,
            Status = results.Status.Value
        };
    }

    private static AmazonCloudWatchLogsClient CreateClientForProfile(string profileName)
    {
        var (credentials, region) = ResolveProfile(profileName);
        return new AmazonCloudWatchLogsClient(credentials, region);
    }

    private static (AWSCredentials credentials, Amazon.RegionEndpoint region) ResolveProfile(string profileName)
    {
        var chain = new CredentialProfileStoreChain();
        if (!chain.TryGetAWSCredentials(profileName, out var credentials))
            throw new System.InvalidOperationException(
                $"AWS profile '{profileName}' not found or has no usable credentials.");

        chain.TryGetProfile(profileName, out var profile);
        var region = profile?.Region ?? Amazon.RegionEndpoint.EUWest1;
        return (credentials, region);
    }
}
