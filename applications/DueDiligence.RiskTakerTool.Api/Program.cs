using Amazon.BedrockAgentRuntime;
using Amazon.BedrockRuntime;
using Amazon.DynamoDBv2;
using Amazon.SQS;
using Amazon.Extensions.NETCore.Setup;
using Amazon.Runtime;
using Amazon.Runtime.CredentialManagement;
using DueDiligenceRiskTakerTool.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(opts =>
{
    opts.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    opts.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Picks up AWS credentials from env vars, ~/.aws/credentials, or IAM role automatically.
// Set AWS_PROFILE or AWS_DEFAULT_REGION env vars to control which account/region is used.
builder.Services.AddAWSService<IAmazonDynamoDB>();
builder.Services.AddAWSService<IAmazonSQS>();

// Bedrock: explicitly load the configured profile so the client never silently
// falls back to a different (potentially expired) default profile.
var bedrockRegion = builder.Configuration["Bedrock:Region"] ?? "eu-west-1";
var bedrockProfile = builder.Configuration["Bedrock:Profile"];

var chain = new CredentialProfileStoreChain();
AWSCredentials bedrockCredentials;
if (!string.IsNullOrEmpty(bedrockProfile) && chain.TryGetAWSCredentials(bedrockProfile, out var profileCreds))
{
    var immutable = profileCreds.GetCredentials();
    Console.WriteLine($"[Bedrock] Profile '{bedrockProfile}' loaded — key ...{immutable.AccessKey[^4..]}  region {bedrockRegion}");
    bedrockCredentials = profileCreds;
}
else
{
    Console.WriteLine($"[Bedrock] WARNING: profile '{bedrockProfile}' not found — falling back to default credential chain");
    bedrockCredentials = FallbackCredentialsFactory.GetCredentials();
}

builder.Services.AddSingleton<IAmazonBedrockRuntime>(new AmazonBedrockRuntimeClient(
    bedrockCredentials,
    new AmazonBedrockRuntimeConfig { RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(bedrockRegion) }
));

builder.Services.AddSingleton<IAmazonBedrockAgentRuntime>(new AmazonBedrockAgentRuntimeClient(
    bedrockCredentials,
    new AmazonBedrockAgentRuntimeConfig { RegionEndpoint = Amazon.RegionEndpoint.GetBySystemName(bedrockRegion) }
));

builder.Services.AddSingleton<Amazon.Runtime.AWSCredentials>(bedrockCredentials);
builder.Services.AddHttpClient("AgentRuntime");

builder.Services.AddScoped<AiQueryService>();
builder.Services.AddScoped<BedrockAgentService>();
builder.Services.AddScoped<AgentRuntimeService>();
builder.Services.AddScoped<DynamoDbService>();
builder.Services.AddScoped<SqsService>();

// Okta JWT Bearer — mirrors ra-tool-bff-api's auth setup.
// IsConfigured fallback: auth only activates when both Authority and Audience are set,
// so local dev without Okta credentials still works (the UI sets AUTH_BYPASS=true).
var oktaAuthority = builder.Configuration["Okta:Authority"];
var oktaAudience  = builder.Configuration["Okta:Audience"];
var oktaConfigured = !string.IsNullOrWhiteSpace(oktaAuthority) && !string.IsNullOrWhiteSpace(oktaAudience);

if (oktaConfigured)
{
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddJwtBearer(options =>
        {
            options.Authority = oktaAuthority;
            options.Audience  = oktaAudience;
            options.RequireHttpsMetadata = true;
        });
    builder.Services.AddAuthorization();
    Console.WriteLine($"[Okta] JWT auth enabled — authority {oktaAuthority}");
}
else
{
    Console.WriteLine("[Okta] Not configured — running unauthenticated (local dev)");
}

builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy =>
        policy.WithOrigins("http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
if (oktaConfigured)
{
    app.UseAuthentication();
    app.UseAuthorization();
}
app.MapControllers();

// Public health endpoint for the ALB target-group health check (no auth).
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();
