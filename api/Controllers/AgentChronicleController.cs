using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using DueDiligenceRiskTakerTool.Api.Models;
using DueDiligenceRiskTakerTool.Api.Services;

namespace DueDiligenceRiskTakerTool.Api.Controllers;

[ApiController]
[Route("agent-chronicle")]
public class AgentChronicleController : ControllerBase
{
    private readonly AgentRuntimeService _agentRuntime;

    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public AgentChronicleController(AgentRuntimeService agentRuntime)
    {
        _agentRuntime = agentRuntime;
    }

    [HttpPost("generate")]
    public async Task<ActionResult<AgentChronicleResponse>> Generate([FromBody] AgentChronicleRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Prompt))
            return BadRequest("Prompt is required.");

        var result = await _agentRuntime.InvokeAsync(request.Prompt, request.SessionId);
        return Ok(new AgentChronicleResponse
        {
            Narrative = result.Narrative,
            InputTokens = result.InputTokens,
            OutputTokens = result.OutputTokens,
        });
    }

    [HttpPost("stream")]
    public async Task StreamGenerate([FromBody] AgentChronicleRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Prompt))
        {
            Response.StatusCode = 400;
            return;
        }

        Response.ContentType = "text/event-stream";
        Response.Headers["Cache-Control"] = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";

        await foreach (var chunk in _agentRuntime.StreamChunksAsync(request.Prompt, request.SessionId, ct))
        {
            var json = JsonSerializer.Serialize(chunk, _jsonOptions);
            await Response.WriteAsync($"data: {json}\n\n", ct);
            await Response.Body.FlushAsync(ct);
        }
    }
}
