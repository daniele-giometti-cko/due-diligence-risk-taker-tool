using Microsoft.AspNetCore.Mvc;
using DueDiligenceRiskTakerTool.Api.Models;
using DueDiligenceRiskTakerTool.Api.Services;

namespace DueDiligenceRiskTakerTool.Api.Controllers;

[ApiController]
[Route("[controller]")]
public class QueryController : ControllerBase
{
    private readonly AiQueryService _aiQueryService;
    private readonly DynamoDbService _dynamoDbService;
    private readonly IConfiguration _config;

    public QueryController(AiQueryService aiQueryService, DynamoDbService dynamoDbService, IConfiguration config)
    {
        _aiQueryService = aiQueryService;
        _dynamoDbService = dynamoDbService;
        _config = config;
    }

    [HttpGet("profiles")]
    public ActionResult<List<string>> GetProfiles()
    {
        return Ok(_dynamoDbService.ListProfiles());
    }

    [HttpGet("env-labels")]
    public ActionResult<Dictionary<string, string>> GetEnvLabels()
    {
        var labels = new Dictionary<string, string>();
        _config.GetSection("EnvironmentLabels").GetChildren()
            .ToList()
            .ForEach(e => labels[e.Key] = e.Value ?? e.Key);
        return Ok(labels);
    }

    [HttpGet("tables")]
    public async Task<ActionResult<List<string>>> GetTables([FromQuery] string? profile = null)
    {
        var tables = await _dynamoDbService.ListTablesAsync(profile);
        return Ok(tables);
    }

    [HttpPost("generate-query")]
    public async Task<ActionResult<DynamoQuery>> GenerateQuery([FromBody] GenerateQueryRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.NaturalLanguage))
            return BadRequest("Natural language input is required.");

        var query = await _aiQueryService.GenerateQueryAsync(request);
        return Ok(query);
    }

    [HttpPost("execute-query")]
    public async Task<ActionResult<ExecuteQueryResponse>> ExecuteQuery([FromBody] DynamoQuery query)
    {
        if (string.IsNullOrWhiteSpace(query.Table))
            return BadRequest("Table name is required.");

        if (query.Operation == "Query" && string.IsNullOrWhiteSpace(query.KeyCondition))
            return BadRequest("KeyCondition is required for Query operations.");

        var result = await _dynamoDbService.ExecuteQueryAsync(query);
        return Ok(result);
    }
}
