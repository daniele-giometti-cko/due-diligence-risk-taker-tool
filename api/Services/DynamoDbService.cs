using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Amazon.Runtime.CredentialManagement;
using DueDiligenceLogsTellerAgent.Api.Models;

namespace DueDiligenceLogsTellerAgent.Api.Services;

public class DynamoDbService
{
    private readonly IAmazonDynamoDB _dynamoDb;

    public DynamoDbService(IAmazonDynamoDB dynamoDb)
    {
        _dynamoDb = dynamoDb;
    }

    // Reads ~/.aws/credentials and returns all profile names found.
    public List<string> ListProfiles()
    {
        var credFile = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".aws", "credentials");

        if (!File.Exists(credFile)) return [];

        return File.ReadLines(credFile)
            .Where(line => line.StartsWith('[') && line.EndsWith(']'))
            .Select(line => line.Trim('[', ']').Trim())
            .Where(name => !string.IsNullOrEmpty(name))
            .ToList();
    }

    public async Task<List<string>> ListTablesAsync(string? profile = null)
    {
        if (string.IsNullOrEmpty(profile))
        {
            var resp = await _dynamoDb.ListTablesAsync();
            return resp.TableNames;
        }

        using var client = CreateClientForProfile(profile);
        var response = await client.ListTablesAsync();
        return response.TableNames;
    }

    public async Task<ExecuteQueryResponse> ExecuteQueryAsync(DynamoQuery query)
    {
        if (string.IsNullOrEmpty(query.Profile))
            return await RunQueryAsync(_dynamoDb, query);

        using var client = CreateClientForProfile(query.Profile);
        return await RunQueryAsync(client, query);
    }

    private static async Task<ExecuteQueryResponse> RunQueryAsync(IAmazonDynamoDB client, DynamoQuery query)
    {
        var exprValues = BuildExpressionValues(query.ExpressionValues);
        var hasFilter = !string.IsNullOrEmpty(query.FilterExpression);
        var hasExprValues = exprValues.Count > 0;

        if (query.Operation == "Scan")
        {
            var req = new ScanRequest
            {
                TableName = query.Table,
                FilterExpression = hasFilter ? query.FilterExpression : null,
                ExpressionAttributeValues = hasExprValues ? exprValues : null,
                Limit = query.Limit ?? 100
            };
            var resp = await client.ScanAsync(req);
            return MapResponse(resp.Items, resp.Count);
        }
        else
        {
            var req = new QueryRequest
            {
                TableName = query.Table,
                KeyConditionExpression = query.KeyCondition,
                FilterExpression = hasFilter ? query.FilterExpression : null,
                ExpressionAttributeValues = hasExprValues ? exprValues : null,
                IndexName = query.IndexName,
                Limit = query.Limit ?? 100
            };
            var resp = await client.QueryAsync(req);
            return MapResponse(resp.Items, resp.Count);
        }
    }

    // Creates a short-lived DynamoDB client using the named AWS profile.
    // Reads region from the profile's ~/.aws/config entry; falls back to eu-west-1.
    private static AmazonDynamoDBClient CreateClientForProfile(string profileName)
    {
        var chain = new CredentialProfileStoreChain();

        if (!chain.TryGetAWSCredentials(profileName, out var credentials))
            throw new InvalidOperationException(
                $"AWS profile '{profileName}' not found or has no usable credentials. " +
                "Check ~/.aws/credentials and ~/.aws/config.");

        chain.TryGetProfile(profileName, out var profile);
        var region = profile?.Region ?? Amazon.RegionEndpoint.EUWest1;

        return new AmazonDynamoDBClient(credentials, region);
    }

    private static Dictionary<string, AttributeValue> BuildExpressionValues(Dictionary<string, object>? values)
    {
        var result = new Dictionary<string, AttributeValue>();
        if (values is null) return result;

        foreach (var (key, value) in values)
        {
            result[key] = value switch
            {
                JsonElement el when el.ValueKind == JsonValueKind.String
                    => new AttributeValue { S = el.GetString() ?? "" },
                JsonElement el when el.ValueKind == JsonValueKind.Number
                    => new AttributeValue { N = el.GetRawText() },
                JsonElement el when el.ValueKind == JsonValueKind.True
                    => new AttributeValue { BOOL = true },
                JsonElement el when el.ValueKind == JsonValueKind.False
                    => new AttributeValue { BOOL = false },
                string s => new AttributeValue { S = s },
                _ => new AttributeValue { S = value?.ToString() ?? "" }
            };
        }

        return result;
    }

    private static ExecuteQueryResponse MapResponse(List<Dictionary<string, AttributeValue>> items, int count) =>
        new()
        {
            Items = items.Select(item =>
                item.ToDictionary(kv => kv.Key, kv => MapAttributeValue(kv.Value))
            ).ToList(),
            Count = count
        };

    private static object? MapAttributeValue(AttributeValue a)
    {
        if (a.S is not null) return a.S;
        if (a.N is not null) return a.N;
        if (a.NULL) return null;
        if (a.SS?.Count > 0) return a.SS;
        if (a.NS?.Count > 0) return a.NS;
        if (a.M?.Count > 0) return a.M.ToDictionary(kv => kv.Key, kv => MapAttributeValue(kv.Value));
        if (a.L?.Count > 0) return a.L.Select(MapAttributeValue).ToList();
        return a.BOOL;
    }
}
