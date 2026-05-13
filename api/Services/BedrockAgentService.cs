using System.Text;
using Amazon.BedrockAgentRuntime;
using Amazon.BedrockAgentRuntime.Model;

namespace DueDiligenceLogsTellerAgent.Api.Services;

public class BedrockAgentService
{
    private readonly IAmazonBedrockAgentRuntime _agentRuntime;
    private readonly IConfiguration _config;

    public BedrockAgentService(IAmazonBedrockAgentRuntime agentRuntime, IConfiguration config)
    {
        _agentRuntime = agentRuntime;
        _config = config;
    }

    public async Task<string> InvokeAgentAsync(string prompt, string? sessionId = null)
    {
        var agentId = _config["Bedrock:AgentId"]
            ?? throw new InvalidOperationException("Bedrock:AgentId is not configured.");
        var agentAliasId = _config["Bedrock:AgentAliasId"]
            ?? throw new InvalidOperationException("Bedrock:AgentAliasId is not configured.");

        var request = new InvokeAgentRequest
        {
            AgentId = agentId,
            AgentAliasId = agentAliasId,
            SessionId = sessionId ?? Guid.NewGuid().ToString(),
            InputText = prompt
        };

        var response = await _agentRuntime.InvokeAgentAsync(request);

        var sb = new StringBuilder();
        Exception? streamException = null;

        response.Completion.ChunkReceived += (_, args) =>
        {
            var bytes = args.EventStreamEvent.Bytes?.ToArray();
            if (bytes is { Length: > 0 })
                sb.Append(Encoding.UTF8.GetString(bytes));
        };

        response.Completion.ExceptionReceived += (_, args) =>
            streamException = args.EventStreamException;

        // StartProcessingAsync drives the event loop; awaiting it means the stream is done.
        await response.Completion.StartProcessingAsync();

        if (streamException is not null)
            throw streamException;

        return sb.ToString();
    }
}
