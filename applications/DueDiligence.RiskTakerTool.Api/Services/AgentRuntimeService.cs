using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Amazon.Runtime;
using DueDiligenceRiskTakerTool.Api.Models;

namespace DueDiligenceRiskTakerTool.Api.Services;

/// <summary>
/// Calls an AgentCore AgentRuntime via raw HTTP + SigV4.
/// No official .NET SDK package exists for bedrock-agentcore yet,
/// so we sign requests manually using the standard AWS SigV4 algorithm.
/// </summary>
public class AgentRuntimeService
{
    private readonly AWSCredentials _credentials;
    private readonly IConfiguration _config;
    private readonly HttpClient _http;

    public AgentRuntimeService(AWSCredentials credentials, IConfiguration config, IHttpClientFactory httpFactory)
    {
        _credentials = credentials;
        _config = config;
        _http = httpFactory.CreateClient("AgentRuntime");
    }

    public async Task<AgentInvokeResult> InvokeAsync(string prompt, string? sessionId = null)
    {
        var runtimeArn = _config["Bedrock:AgentRuntimeArn"]
            ?? throw new InvalidOperationException("Bedrock:AgentRuntimeArn is not configured.");
        var region = _config["Bedrock:Region"] ?? "eu-west-1";

        var creds = _credentials.GetCredentials();
        var sid = sessionId ?? Guid.NewGuid().ToString();

        // payload is the raw body; runtimeSessionId is a header per the botocore service model
        var body = JsonSerializer.Serialize(new { prompt });

        var encodedArn = Uri.EscapeDataString(runtimeArn);
        var url = new Uri(
            $"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{encodedArn}/invocations?qualifier=DEFAULT");

        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        request.Headers.TryAddWithoutValidation("X-Amzn-Bedrock-AgentCore-Runtime-Session-Id", sid);

        AddSigV4Headers(request, body, "bedrock-agentcore", region, creds);

        var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();

        return await ReadResponseAsync(response);
    }

    public async IAsyncEnumerable<AgentStreamChunk> StreamChunksAsync(
        string prompt,
        string? sessionId = null,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        var runtimeArn = _config["Bedrock:AgentRuntimeArn"]
            ?? throw new InvalidOperationException("Bedrock:AgentRuntimeArn is not configured.");
        var region = _config["Bedrock:Region"] ?? "eu-west-1";

        var creds = _credentials.GetCredentials();
        var sid = sessionId ?? Guid.NewGuid().ToString();
        var body = JsonSerializer.Serialize(new { prompt });

        var encodedArn = Uri.EscapeDataString(runtimeArn);
        var url = new Uri(
            $"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{encodedArn}/invocations?qualifier=DEFAULT");

        var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
        request.Headers.TryAddWithoutValidation("X-Amzn-Bedrock-AgentCore-Runtime-Session-Id", sid);
        AddSigV4Headers(request, body, "bedrock-agentcore", region, creds);

        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream, Encoding.UTF8);

        while (!reader.EndOfStream)
        {
            ct.ThrowIfCancellationRequested();
            var line = await reader.ReadLineAsync(ct);
            if (line?.StartsWith("data: ") != true) continue;

            var data = line[6..];
            if (data.Length >= 2 && data[0] == '"' && data[^1] == '"')
                data = JsonSerializer.Deserialize<string>(data) ?? data;

            const string metricsPrefix = "\n__METRICS__:";
            var metricsIdx = data.IndexOf(metricsPrefix, StringComparison.Ordinal);
            if (metricsIdx >= 0)
            {
                if (metricsIdx > 0)
                    yield return new AgentStreamChunk(data[..metricsIdx], null, null);

                var metricsJson = data[(metricsIdx + metricsPrefix.Length)..];
                int inputTokens = 0, outputTokens = 0;
                try
                {
                    using var doc = JsonDocument.Parse(metricsJson);
                    inputTokens = doc.RootElement.GetProperty("inputTokens").GetInt32();
                    outputTokens = doc.RootElement.GetProperty("outputTokens").GetInt32();
                }
                catch { }
                yield return new AgentStreamChunk(null, inputTokens, outputTokens);
            }
            else if (!string.IsNullOrEmpty(data))
            {
                yield return new AgentStreamChunk(data, null, null);
            }
        }

        yield return new AgentStreamChunk(null, null, null, Done: true);
    }

    // ---------------------------------------------------------------------------
    // SSE response reader
    // ---------------------------------------------------------------------------

    private static async Task<AgentInvokeResult> ReadResponseAsync(HttpResponseMessage response)
    {
        var contentType = response.Content.Headers.ContentType?.MediaType ?? "";
        if (!contentType.Contains("text/event-stream"))
        {
            var raw = await response.Content.ReadAsStringAsync();
            return new AgentInvokeResult(raw, 0, 0);
        }

        var sb = new StringBuilder();
        int inputTokens = 0, outputTokens = 0;

        using var stream = await response.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(stream, Encoding.UTF8);

        while (!reader.EndOfStream)
        {
            var line = await reader.ReadLineAsync();
            if (line?.StartsWith("data: ") != true)
                continue;

            var data = line[6..];

            // The runtime wraps yielded strings in JSON quotes: data: "hello world"
            if (data.Length >= 2 && data[0] == '"' && data[^1] == '"')
                data = JsonSerializer.Deserialize<string>(data) ?? data;

            // Detect the metrics sentinel emitted at the end of the Python stream
            const string metricsPrefix = "\n__METRICS__:";
            var metricsIdx = data.IndexOf(metricsPrefix, StringComparison.Ordinal);
            if (metricsIdx >= 0)
            {
                sb.Append(data[..metricsIdx]);
                var metricsJson = data[(metricsIdx + metricsPrefix.Length)..];
                try
                {
                    using var doc = JsonDocument.Parse(metricsJson);
                    inputTokens = doc.RootElement.GetProperty("inputTokens").GetInt32();
                    outputTokens = doc.RootElement.GetProperty("outputTokens").GetInt32();
                }
                catch { /* best-effort */ }
            }
            else
            {
                sb.Append(data);
            }
        }

        return new AgentInvokeResult(sb.ToString(), inputTokens, outputTokens);
    }

    // ---------------------------------------------------------------------------
    // SigV4 signing
    // ---------------------------------------------------------------------------

    private static void AddSigV4Headers(
        HttpRequestMessage request,
        string body,
        string service,
        string region,
        ImmutableCredentials creds)
    {
        var now = DateTime.UtcNow;
        var amzDate = now.ToString("yyyyMMddTHHmmssZ");
        var dateStamp = now.ToString("yyyyMMdd");

        var host = request.RequestUri!.Host;
        request.Headers.TryAddWithoutValidation("x-amz-date", amzDate);
        request.Headers.Host = host;
        if (!string.IsNullOrEmpty(creds.Token))
            request.Headers.TryAddWithoutValidation("x-amz-security-token", creds.Token);

        var bodyHash = Sha256Hex(body);

        // Canonical query string — keys must be sorted
        var rawQuery = request.RequestUri.Query.TrimStart('?');
        var canonicalQuery = string.Join("&",
            rawQuery.Split('&', StringSplitOptions.RemoveEmptyEntries).OrderBy(p => p));

        // Signed headers must match boto3: host, x-amz-date, x-amz-security-token, session-id
        // content-type is intentionally NOT signed (boto3 omits it for this service)
        var sessionId = request.Headers.TryGetValues("X-Amzn-Bedrock-AgentCore-Runtime-Session-Id", out var vals)
            ? vals.First() : "";

        var headers = new SortedDictionary<string, string>
        {
            ["host"] = host,
            ["x-amz-date"] = amzDate,
            ["x-amzn-bedrock-agentcore-runtime-session-id"] = sessionId,
        };
        if (!string.IsNullOrEmpty(creds.Token))
            headers["x-amz-security-token"] = creds.Token;

        var canonicalHeaders = string.Join("\n", headers.Select(h => $"{h.Key}:{h.Value}")) + "\n";
        var signedHeaders = string.Join(";", headers.Keys);

        var canonicalRequest = string.Join("\n",
            "POST",
            BotocoreCanonicalUri(request.RequestUri),
            canonicalQuery,
            canonicalHeaders,
            signedHeaders,
            bodyHash);

        var credentialScope = $"{dateStamp}/{region}/{service}/aws4_request";
        var stringToSign = string.Join("\n",
            "AWS4-HMAC-SHA256",
            amzDate,
            credentialScope,
            Sha256Hex(canonicalRequest));

        var signingKey = DeriveSigningKey(creds.SecretKey, dateStamp, region, service);
        var signature = HmacHex(signingKey, stringToSign);

        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue(
            "AWS4-HMAC-SHA256",
            $"Credential={creds.AccessKey}/{credentialScope}, SignedHeaders={signedHeaders}, Signature={signature}");
    }

    private static byte[] DeriveSigningKey(string secretKey, string dateStamp, string region, string service)
    {
        var kDate = HmacBytes(Encoding.UTF8.GetBytes("AWS4" + secretKey), dateStamp);
        var kRegion = HmacBytes(kDate, region);
        var kService = HmacBytes(kRegion, service);
        return HmacBytes(kService, "aws4_request");
    }

    private static string Sha256Hex(string text)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLower();

    private static string HmacHex(byte[] key, string message)
        => Convert.ToHexString(HmacBytes(key, message)).ToLower();

    private static byte[] HmacBytes(byte[] key, string message)
    {
        using var hmac = new HMACSHA256(key);
        return hmac.ComputeHash(Encoding.UTF8.GetBytes(message));
    }

    // Matches botocore's quote(normalize_url_path(path), safe='/~'):
    // re-encodes every character except unreserved chars, '/', and '~'.
    // This double-encodes percent signs so %3A → %253A, matching AWS server-side verification.
    private static string BotocoreCanonicalUri(Uri uri)
    {
        var path = uri.AbsolutePath;
        var sb = new StringBuilder(path.Length * 3);
        foreach (char c in path)
        {
            if (c == '/' || c == '~' ||
                (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                (c >= '0' && c <= '9') ||
                c == '-' || c == '_' || c == '.')
                sb.Append(c);
            else
                sb.Append('%').Append(((int)c).ToString("X2"));
        }
        return sb.ToString();
    }
}
