namespace DueDiligenceLogsTellerAgent.Api.Models;

public class GenerateCloudWatchQueryRequest
{
    public string NaturalLanguage { get; set; } = string.Empty;
    public string? LogGroupName { get; set; }
}

public class CloudWatchQuery
{
    public string LogGroupName { get; set; } = string.Empty;
    public string QueryString { get; set; } = string.Empty;
    public int LookbackHours { get; set; } = 24;
    public string? Profile { get; set; }
}

public class CloudWatchQueryResult
{
    public List<Dictionary<string, object?>> Items { get; set; } = new();
    public int Count { get; set; }
    public string Status { get; set; } = string.Empty;
}

public class ChronicleRequest
{
    public string LogGroupName { get; set; } = string.Empty;
    public string? Profile { get; set; }
    public List<Dictionary<string, object?>> Items { get; set; } = new();
}

public class ChronicleResponse
{
    public string Narrative { get; set; } = string.Empty;
    public int ItemCount { get; set; }
}
