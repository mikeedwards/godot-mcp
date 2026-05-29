# Plan: Educational Game Stack (C# server + Django CMS) on tools-platform

> **Status:** design draft, captured from a planning session in the `godot-mcp` repo.
> **Intended home:** `mikeedwards/tools-platform` (this stack does **not** belong in `godot-mcp`).
> `godot-mcp` is a dev-time AI tool for editing Godot projects — unrelated to this runtime backend.

## Goal

A backend for an **educational Godot game** focused on **delivering content** and
**guiding individual players** (adaptive hints/nudges, progress, mastery) — *not*
real-time multiplayer.

## Why this shape

- Godot 4.x speaks standard protocols, so the backend can be any language. We chose **C#**
  for the game server specifically to **share typed models with the Godot client** (Godot's
  C# runs on .NET 8, same as ASP.NET Core).
- The **CMS is separated** from the game server: Django (authoring + content API) is a
  distinct service from the C# runtime server.

## Architecture

```
                    ┌─────────────────────────────────────┐
Godot client ──────▶│  C# Game Server (ASP.NET Core)       │
 (HTTPRequest /     │   • player progress / guidance logic │──▶ Postgres (player state)
  WebSocketPeer)    │   • SignalR hub for live nudges      │
                    └──────────────┬──────────────────────-┘
                                   │ REST/JSON (server-to-server)
                                   ▼
                    ┌─────────────────────────────────────┐
                    │  Django CMS + Django-Q2              │──▶ Postgres (content)
                    │   • Django admin = authoring UI      │
                    │   • DRF = content API                │
                    │   • Django-Q2 = background jobs       │
   authors ────────▶│     (publish, precompute, schedule)  │
   (admin web UI)   └─────────────────────────────────────┘
```

**Key boundary rule:** the Godot client only talks to the C# server. The C# server pulls
content from Django, caches it, merges with per-player state, runs guidance. Django is the
content/authoring plane only and never sees a game client.

## Services

### 1. `game-cms` — Django + Django-Q2 (content plane)
- Django + **DRF** content API; **Django admin** as the authoring UI.
- **Django-Q2** (the actively maintained fork of Django-Q) worker for async/scheduled jobs:
  timed publish/embargo, precompute per-learner recommendations, batch hint generation,
  mastery rollups, scheduled nudges.
- Deploy as **two services off one image**: `web` (gunicorn) + `qcluster` (Django-Q2 worker),
  same code, different command.
- **S3** for static/media via `django-storages`. DB: `gamecms`. Broker: Redis.

### 2. `game-server` — ASP.NET Core (runtime plane)
- REST for content/progress + **SignalR hub** for live guidance.
  ALB target needs **WebSocket + sticky sessions**.
- Talks to `game-cms` server-to-server over REST; caches content; owns player state
  in DB `gameserver` (EF Core). Optional Redis SignalR backplane when scaling past one task.

### 3. `Shared` — .NET class library
- POCO/record DTOs shared between the **Godot C# client and `game-server`**
  (`Lesson`, `PlayerProgress`, `GuidanceMessage`, …).
- Pure POCOs only — **no Godot types, no ASP.NET types**. Target `net8.0` (or `netstandard2.1`).
- Distribute as private NuGet (AWS CodeArtifact) or in-solution project reference.

## Cross-language boundary note

The **shared-models win is C#↔C# only** (Godot client ↔ game server). The **Django→C#**
boundary is a JSON contract across a language boundary — no shared objects. Keep parity by:
- hand-maintaining DRF serializers to match the C# DTOs (start here), then
- **drf-spectacular (OpenAPI) → NSwag (C# codegen)** once the contract starts drifting.

## Hosting on tools-platform (assumed conventions — verify against the repo)

- **Compute:** ECS Fargate services behind the shared ALB; each service = task def + service +
  target group, routed by path/host.
- **Database:** shared RDS Postgres, **separate databases** (`gamecms`, `gameserver`).
- **Secrets:** AWS Secrets Manager, injected into task defs as `secrets` (never baked in images).
- **Broker/cache:** reuse platform Redis if present, else small ElastiCache Redis for Django-Q2
  (and later the SignalR backplane).

## Proposed repo layout (in tools-platform)

```
tools-platform/
  services/
    game-cms/         # Django project + Dockerfile (web + qcluster commands)
    game-server/      # ASP.NET Core + Dockerfile
  libs/
    Shared/           # .NET DTO library (also consumed by the Godot client)
  infra/              # IaC: task defs, ALB rules, RDS DBs, secrets, S3
  docs/plans/game-stack.md
```

## Open items to confirm from the tools-platform repo

1. IaC tool (Terraform vs CDK vs raw) — match existing task defs / ALB rules.
2. ALB routing convention (path vs subdomain) + how WebSocket-capable targets are configured.
3. Existing RDS instance + whether Redis already runs on the platform.
4. CI/CD: how other tools build/push images and deploy, so these two slot into the same pipeline.
5. Auth: how internal admin UIs (e.g. Django admin) are fronted today.

## Next steps

- [ ] Re-open a session scoped to `mikeedwards/tools-platform` (or an env with both repos).
- [ ] Read the real ECS/RDS/secrets/CI conventions; reconcile with the assumptions above.
- [ ] Scaffold `libs/Shared` with example DTOs.
- [ ] Scaffold `services/game-server` (ASP.NET Core + SignalR hub skeleton).
- [ ] Scaffold `services/game-cms` (Django + DRF + Django-Q2, web/qcluster split Dockerfile).
- [ ] Wire infra (task defs, ALB rules, DBs, secrets) following platform conventions.
