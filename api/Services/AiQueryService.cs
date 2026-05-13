using System.Text.Json;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using DueDiligenceLogsTellerAgent.Api.Models;

namespace DueDiligenceLogsTellerAgent.Api.Services;

public class AiQueryService
{
    private readonly IAmazonBedrockRuntime _bedrock;
    private readonly IConfiguration _config;

    // This prompt is the core contract with the AI. Keep it strict so the output
    // is always parseable as DynamoQuery without extra cleanup.
    private const string DynamoDbSystemPrompt = """
        You are a DynamoDB query generator. Convert natural language to a DynamoDB query JSON object.

        RULES:
        - Return ONLY valid JSON. No explanation, no markdown, no code fences.
        - Follow this exact schema:
        {
          "operation": "Query" | "Scan",
          "table": "string",
          "keyCondition": "string (e.g. 'PK = :pk AND begins_with(SK, :sk)')",
          "filterExpression": "string or null",
          "expressionValues": { ":pk": "value", ":sk": "value" },
          "indexName": "string or null",
          "limit": number or null
        }
        - Use :param notation for all values in expressions.
        - For Scan, set keyCondition to empty string "".
        - If a table is not mentioned, use "unknown" as table name.
        """;

    private const string CloudWatchSystemPrompt = """
        You are a CloudWatch Logs Insights query generator. Convert natural language to a CloudWatch Insights query.

        RULES:
        - Return ONLY valid JSON. No explanation, no markdown, no code fences.
        - Follow this exact schema:
        {
          "logGroupName": "string (use the one provided, or infer from the known services below)",
          "queryString": "valid CloudWatch Logs Insights syntax",
          "lookbackHours": number (1=last hour, 24=last day, 120=last 5 days, 168=last week; default 120)
        }
        - CloudWatch Insights syntax examples:
          fields @timestamp, @message | filter @message like /pattern/ | sort @timestamp desc | limit 100
          fields @timestamp, @message | filter @logStream like /lambda/ | limit 50
          stats count(*) by bin(5m) | sort @timestamp desc
        - Always include | limit 100 at the end unless the user asks for a different amount.
        - Use like /pattern/ for text search, not =.
        - To filter for chronicle/business-significant events only, add: | filter @message like /CHRONICLE/

        KNOWN LOG GROUPS (use these when the user refers to these services by name):
        - "notifier" or "case notifier"       → /aws/lambda/due-diligence-pep-case-notifier-lambda
        - "llm adjudicator" or "adjudicator"  → /aws/lambda/due-diligence-llm-adjudicator-lambda
        - "bac" or "validifi" or "bac validifi" → /aws/lambda/due-diligence-plugin-bac-validifi-lambda
        - "idv" or "shared idv"               → /aws/lambda/due-diligence-plugin-shared-idv-lambda
        - "scraper" or "case scraper"         → /aws/ecs/due-diligence-pep-case-data-scraper
        - "full case scraper" or "pep full"   → /aws/ecs/due-diligence-pep-full-case-data-scraper
        """;

    public AiQueryService(IAmazonBedrockRuntime bedrock, IConfiguration config)
    {
        _bedrock = bedrock;
        _config = config;
    }

    public async Task<DynamoQuery> GenerateQueryAsync(GenerateQueryRequest request)
    {
        var userMessage = request.TableName is not null
            ? $"Table: {request.TableName}\nQuery: {request.NaturalLanguage}"
            : request.NaturalLanguage;

        var text = await InvokeBedrockAsync(DynamoDbSystemPrompt, userMessage);

        return JsonSerializer.Deserialize<DynamoQuery>(text, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("AI returned unparseable JSON.");
    }

    public async Task<CloudWatchQuery> GenerateCloudWatchQueryAsync(GenerateCloudWatchQueryRequest request)
    {
        var userMessage = request.LogGroupName is not null
            ? $"Log group: {request.LogGroupName}\nQuery: {request.NaturalLanguage}"
            : request.NaturalLanguage;

        var text = await InvokeBedrockAsync(CloudWatchSystemPrompt, userMessage);

        return JsonSerializer.Deserialize<CloudWatchQuery>(text, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("AI returned unparseable JSON.");
    }

    private const string ChronicleSystemPrompt = """
        You are a Due Diligence platform analyst. Given structured CloudWatch log events from a service,
        write a clear chronological narrative of what happened — what the system processed, what decisions
        were made, and any notable outcomes or anomalies.

        RULES:
        - Write in plain prose, no bullet points, no headers.
        - Use past tense. Be concise but complete.
        - Reference case IDs, match IDs, and entity IDs when they add clarity.
        - Note counts (inserted, updated, ignored, failed) when they appear in the logs.
        - Flag errors or warnings prominently.
        - Do not invent facts not present in the log data.
        - Keep the narrative under 400 words.
        """;

    public async Task<ChronicleResponse> GenerateChronicleAsync(ChronicleRequest request)
    {
        static bool IsNoiseField(string key) =>
            key is "@ptr" or "@ingestionTime" or "@logStream" or "@log";

        var noise = new HashSet<string> { "@ptr", "@ingestionTime", "@logStream", "@log" };

        var rows = request.Items
            .Take(150)
            .Select(row => row
                .Where(kv => !noise.Contains(kv.Key))
                .ToDictionary(kv => kv.Key, kv => kv.Value))
            .ToList();

        var logJson = JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = false });

        var userMessage = $"""
            Service log group: {request.LogGroupName}
            Total events: {rows.Count}{(request.Items.Count > 150 ? $" (truncated from {request.Items.Count})" : "")}

            Events (chronological):
            {logJson}
            """;

        var narrative = await InvokeBedrockAsync(ChronicleSystemPrompt, userMessage, maxTokens: 1024);

        return new ChronicleResponse
        {
            Narrative = narrative,
            ItemCount = rows.Count
        };
    }

    private async Task<string> InvokeBedrockAsync(string systemPrompt, string userMessage, int maxTokens = 1024)
    {
        var modelId = _config["Bedrock:ModelId"] ?? "eu.anthropic.claude-opus-4-6-v1:0";

        var payload = new
        {
            anthropic_version = "bedrock-2023-05-31",
            max_tokens = maxTokens,
            system = systemPrompt,
            messages = new[] { new { role = "user", content = userMessage } }
        };

        var invokeRequest = new InvokeModelRequest
        {
            ModelId = modelId,
            ContentType = "application/json",
            Accept = "application/json",
            Body = new MemoryStream(JsonSerializer.SerializeToUtf8Bytes(payload))
        };

        InvokeModelResponse response;
        try
        {
            response = await _bedrock.InvokeModelAsync(invokeRequest);
        }
        catch (AccessDeniedException ex)
        {
            throw new InvalidOperationException(
                $"Bedrock access denied for model '{modelId}'. " +
                "Ensure your AWS credentials have bedrock:InvokeModel permission and the model is enabled.",
                ex);
        }

        using var doc = JsonDocument.Parse(response.Body);
        return doc.RootElement
            .GetProperty("content")[0]
            .GetProperty("text")
            .GetString() ?? throw new InvalidOperationException("Empty response from Bedrock.");
    }
}
