# Deepti's Journey Video Automation

## Overview
A Mastra-based automation that generates an empathetic, conversational video telling Deepti's inspiring journey from kidney failure to tech builder, hackathon winner, and non-profit founder.

## Architecture
- **Framework**: Mastra (TypeScript) with Inngest for workflow orchestration
- **Trigger**: Time-based cron (weekly Sunday 9 AM UTC, configurable via `SCHEDULE_CRON_EXPRESSION` env var)
- **LLM**: OpenAI via Replit AI Integrations (no API key needed)

## Workflow Pipeline
1. **generate-script** — AI agent writes a 7-scene empathetic narration script in first person
2. **generate-audio** — Parallel TTS generation using OpenAI gpt-audio model (Nova voice) for all scenes
3. **generate-images** — Parallel image generation using OpenAI gpt-image-1 (watercolor art style)
4. **compose-video** — FFmpeg composition: image + audio per scene with fade transitions and text overlays
5. **finalize-output** — Logs completion summary

## Key Files
- `src/mastra/agents/agent.ts` — Journey video script agent with full journey context
- `src/mastra/workflows/workflow.ts` — 5-step workflow pipeline
- `src/mastra/index.ts` — Mastra instance with agent, workflow, and cron trigger registration
- `src/triggers/cronTriggers.ts` — Cron trigger helper
- `tests/testCronAutomation.ts` — Manual test trigger

## Output
- Video saved to `/tmp/journey-video/deepti-journey-video.mp4`
- Intermediate files: `/tmp/journey-video/scenes/` (audio WAV, image PNG, segment MP4 files)
- Duration: ~3.5 minutes, 7 scenes, ~23 MB

## Dependencies
- OpenAI (via Replit AI Integrations) for script generation, TTS, and image generation
- FFmpeg (system-level) for video composition
- Inngest for workflow orchestration and cron scheduling
