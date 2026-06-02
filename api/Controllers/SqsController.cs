using Microsoft.AspNetCore.Mvc;
using DueDiligenceRiskTakerTool.Api.Models;
using DueDiligenceRiskTakerTool.Api.Services;

namespace DueDiligenceRiskTakerTool.Api.Controllers;

[ApiController]
[Route("sqs")]
public class SqsController : ControllerBase
{
    private readonly SqsService _sqs;

    public SqsController(SqsService sqs)
    {
        _sqs = sqs;
    }

    [HttpGet("queues")]
    public async Task<ActionResult<List<SqsQueue>>> GetQueues([FromQuery] string? profile = null)
    {
        var queues = await _sqs.ListQueuesAsync(profile);
        return Ok(queues);
    }

    [HttpPost("send")]
    public async Task<ActionResult<SqsSendResponse>> Send([FromBody] SqsSendRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.QueueUrl))
            return BadRequest("QueueUrl is required.");
        if (string.IsNullOrWhiteSpace(request.Body))
            return BadRequest("Message body is required.");

        var result = await _sqs.SendMessageAsync(request);
        return Ok(result);
    }

    // Purge is destructive and irreversible. Guardrail: the caller must type the exact
    // queue name (last path segment of the URL) into `confirmation`.
    [HttpPost("purge")]
    public async Task<IActionResult> Purge([FromBody] SqsPurgeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.QueueUrl))
            return BadRequest("QueueUrl is required.");

        var queueName = request.QueueUrl.Split('/').Last();
        if (!string.Equals(request.Confirmation?.Trim(), queueName, StringComparison.Ordinal))
            return BadRequest($"Confirmation must exactly match the queue name '{queueName}' to purge.");

        await _sqs.PurgeQueueAsync(request.QueueUrl, request.Profile);
        return Ok(new { purged = queueName });
    }
}
