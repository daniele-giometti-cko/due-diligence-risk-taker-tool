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
