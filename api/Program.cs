using Amazon.BedrockAgentRuntime;
using Amazon.BedrockRuntime;
using Amazon.DynamoDBv2;
using Amazon.Extensions.NETCore.Setup;
using Amazon.Runtime;
using Amazon.Runtime.CredentialManagement;
using DueDiligenceLogsTellerAgent.Api.Services;

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
app.MapControllers();

app.Run();
