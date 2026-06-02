# POC Dockerfile for the Risk-Taker Tool API.
# Stock mcr.microsoft.com base images for fast, dependency-free local builds.
# Productionization (Phase 3) will switch to the CKO pki-dotnet base + Checkout.Diagnostics.
# Build context = the Api directory:  docker build -f applications/DueDiligence.RiskTakerTool.Api/Dockerfile applications/DueDiligence.RiskTakerTool.Api
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /src
COPY *.csproj ./
RUN dotnet restore
COPY . ./
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine
WORKDIR /app
COPY --from=build /app ./
# .NET 8 container images default to port 8080; be explicit for clarity.
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "DueDiligenceRiskTakerTool.Api.dll"]
