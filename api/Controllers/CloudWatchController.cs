using Microsoft.AspNetCore.Mvc;
using DueDiligenceLogsTellerAgent.Api.Models;
using DueDiligenceLogsTellerAgent.Api.Services;

namespace DueDiligenceLogsTellerAgent.Api.Controllers;

[ApiController]
[Route("[controller]")]
public class CloudWatchController : ControllerBase
{
    private readonly AiQueryService _aiQueryService;
    private readonly CloudWatchService _cloudWatchService;

    public CloudWatchController(AiQueryService aiQueryService, CloudWatchService cloudWatchService)
    {
        _aiQueryService = aiQueryService;
        _cloudWatchService = cloudWatchService;
    }

    [HttpGet("log-groups")]
    public async Task<ActionResult<List<string>>> GetLogGroups([FromQuery] string? profile = null)
    {
        var groups = await _cloudWatchService.ListLogGroupsAsync(profile);
        return Ok(groups);
    }

    [HttpPost("generate-query")]
    public async Task<ActionResult<CloudWatchQuery>> GenerateQuery([FromBody] GenerateCloudWatchQueryRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.NaturalLanguage))
            return BadRequest("Natural language input is required.");

        var query = await _aiQueryService.GenerateCloudWatchQueryAsync(request);
        return Ok(query);
    }

    [HttpPost("query")]
    public async Task<ActionResult<CloudWatchQueryResult>> RunQuery([FromBody] CloudWatchQuery query)
    {
        if (string.IsNullOrWhiteSpace(query.LogGroupName))
            return BadRequest("LogGroupName is required.");

        if (string.IsNullOrWhiteSpace(query.QueryString))
            return BadRequest("QueryString is required.");

        var result = await _cloudWatchService.RunQueryAsync(query);
        return Ok(result);
    }

    [HttpPost("chronicle")]
    public async Task<ActionResult<ChronicleResponse>> GenerateChronicle([FromBody] ChronicleRequest request)
    {
        if (!request.Items.Any())
            return BadRequest("No log items to chronicle.");

        var result = await _aiQueryService.GenerateChronicleAsync(request);
        return Ok(result);
    }
}
