namespace DueDiligenceRiskTakerTool.Api.Models;

public class GenerateQueryRequest
{
    public string NaturalLanguage { get; set; } = string.Empty;
    public string? TableName { get; set; }
}

public class DynamoQuery
{
    public string Operation { get; set; } = "Query";
    public string Table { get; set; } = string.Empty;
    public string KeyCondition { get; set; } = string.Empty;
    public string? FilterExpression { get; set; }
    public Dictionary<string, object>? ExpressionValues { get; set; }
    public string? IndexName { get; set; }
    public int? Limit { get; set; }
    public string? Profile { get; set; }
}

public class ExecuteQueryResponse
{
    public List<Dictionary<string, object?>> Items { get; set; } = new();
    public int Count { get; set; }
}

public class AgentChronicleRequest
{
    public string Prompt { get; set; } = string.Empty;
    public string? SessionId { get; set; }
}

public class AgentChronicleResponse
{
    public string Narrative { get; set; } = string.Empty;
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
}

public record AgentInvokeResult(string Narrative, int InputTokens, int OutputTokens);

public record AgentStreamChunk(string? Text, int? InputTokens, int? OutputTokens, bool Done = false);
