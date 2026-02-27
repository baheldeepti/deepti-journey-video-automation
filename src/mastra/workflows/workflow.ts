import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { journeyVideoAgent } from "../agents/agent";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const openaiClient = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const OUTPUT_DIR = "/tmp/journey-video";

const sceneSchema = z.object({
  sceneNumber: z.number(),
  title: z.string(),
  narration: z.string(),
  imagePrompt: z.string(),
  emotionalTone: z.string(),
});

const generateScript = createStep({
  id: "generate-script",
  description:
    "Uses AI agent to generate an empathetic 7-scene video narration script telling Deepti's journey from kidney failure to tech builder",
  inputSchema: z.object({}),
  outputSchema: z.object({
    scenes: z.array(sceneSchema),
  }),
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🎬 [generate-script] Starting script generation...");

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.mkdirSync(path.join(OUTPUT_DIR, "scenes"), { recursive: true });

    const response = await journeyVideoAgent.generate([
      {
        role: "user",
        content:
          "Create a 7-scene video script for Deepti's journey from kidney failure to tech builder and community leader. Cover: diagnosis, dialysis struggle, transplant, first steps into vibecoding, hackathon victories, founding MediMate Foundation, and the inspirational message. Make it deeply empathetic, conversational, and told in first person. The viewer should feel like Deepti is sitting right across from them sharing her heart.",
      },
    ]);

    logger?.info("📝 [generate-script] Agent response received, parsing JSON...");

    let scriptData: any;
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in agent response");
      }
      scriptData = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      logger?.error("❌ [generate-script] Failed to parse script JSON", {
        responseText: response.text.substring(0, 500),
      });
      throw new Error(
        `Failed to parse script: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      );
    }

    if (!scriptData.scenes || !Array.isArray(scriptData.scenes)) {
      throw new Error("Script missing scenes array");
    }

    if (scriptData.scenes.length < 3 || scriptData.scenes.length > 10) {
      throw new Error(
        `Expected 3-10 scenes, got ${scriptData.scenes.length}`,
      );
    }

    for (const scene of scriptData.scenes) {
      if (!scene.sceneNumber || !scene.title || !scene.narration || !scene.imagePrompt || !scene.emotionalTone) {
        throw new Error(
          `Scene ${scene.sceneNumber || "?"} missing required fields (title, narration, imagePrompt, emotionalTone)`,
        );
      }
    }

    logger?.info(
      `✅ [generate-script] Generated ${scriptData.scenes.length} scenes`,
    );
    for (const scene of scriptData.scenes) {
      logger?.info(
        `   Scene ${scene.sceneNumber}: "${scene.title}" (${scene.emotionalTone})`,
      );
    }

    return { scenes: scriptData.scenes };
  },
});

const generateAudio = createStep({
  id: "generate-audio",
  description:
    "Converts each scene's narration text into speech audio files using OpenAI TTS with a warm conversational voice",
  inputSchema: z.object({
    scenes: z.array(sceneSchema),
  }),
  outputSchema: z.object({
    scenes: z.array(sceneSchema),
    audioPaths: z.array(z.string()),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(
      `🎙️ [generate-audio] Generating audio for ${inputData.scenes.length} scenes in parallel...`,
    );

    const generateSingleAudio = async (scene: typeof inputData.scenes[0]): Promise<{ sceneNumber: number; audioPath: string }> => {
      logger?.info(
        `🔊 [generate-audio] Processing scene ${scene.sceneNumber}: "${scene.title}"`,
      );

      const response = await openaiClient.chat.completions.create({
        model: "gpt-audio" as any,
        modalities: ["text", "audio"] as any,
        audio: { voice: "nova", format: "wav" } as any,
        messages: [
          {
            role: "system",
            content:
              "You are a text-to-speech assistant. Read the following text exactly as written, with a warm, empathetic, conversational tone. Speak slowly and clearly, with natural pauses at commas and periods. This is a deeply personal story being shared. Do NOT add or change any words.",
          },
          {
            role: "user",
            content: scene.narration,
          },
        ],
      });

      const audioData =
        (response.choices[0]?.message as any)?.audio?.data ?? "";
      if (!audioData) {
        throw new Error(`No audio data received for scene ${scene.sceneNumber}`);
      }

      const audioBuffer = Buffer.from(audioData, "base64");
      const audioPath = path.join(
        OUTPUT_DIR,
        "scenes",
        `scene-${scene.sceneNumber}-audio.wav`,
      );
      fs.writeFileSync(audioPath, audioBuffer);

      logger?.info(
        `✅ [generate-audio] Scene ${scene.sceneNumber} audio saved (${(audioBuffer.length / 1024).toFixed(0)} KB)`,
      );

      return { sceneNumber: scene.sceneNumber, audioPath };
    };

    const results = await Promise.all(
      inputData.scenes.map((scene) => generateSingleAudio(scene)),
    );

    results.sort((a, b) => a.sceneNumber - b.sceneNumber);
    const audioPaths = results.map((r) => r.audioPath);

    logger?.info(
      `✅ [generate-audio] All ${audioPaths.length} audio files generated`,
    );
    return { scenes: inputData.scenes, audioPaths };
  },
});

const generateImages = createStep({
  id: "generate-images",
  description:
    "Generates artistic illustrative images for each scene using OpenAI image generation",
  inputSchema: z.object({
    scenes: z.array(sceneSchema),
    audioPaths: z.array(z.string()),
  }),
  outputSchema: z.object({
    scenes: z.array(sceneSchema),
    audioPaths: z.array(z.string()),
    imagePaths: z.array(z.string()),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info(
      `🎨 [generate-images] Generating images for ${inputData.scenes.length} scenes in parallel...`,
    );

    const generateSingleImage = async (scene: typeof inputData.scenes[0]): Promise<{ sceneNumber: number; imagePath: string }> => {
      logger?.info(
        `🖼️ [generate-images] Creating image for scene ${scene.sceneNumber}: "${scene.title}"`,
      );

      const enhancedPrompt = `${scene.imagePrompt}. Style: warm watercolor digital painting, soft colors, emotional and uplifting, cinematic lighting, inspirational mood. No text in the image. Aspect ratio 16:9 landscape.`;

      const response = await openaiClient.images.generate({
        model: "gpt-image-1" as any,
        prompt: enhancedPrompt,
        n: 1,
        size: "1536x1024" as any,
      });

      const base64 = (response.data[0] as any)?.b64_json ?? "";
      if (!base64) {
        throw new Error(`No image data received for scene ${scene.sceneNumber}`);
      }

      const imageBuffer = Buffer.from(base64, "base64");
      const imagePath = path.join(
        OUTPUT_DIR,
        "scenes",
        `scene-${scene.sceneNumber}-image.png`,
      );
      fs.writeFileSync(imagePath, imageBuffer);

      logger?.info(
        `✅ [generate-images] Scene ${scene.sceneNumber} image saved (${(imageBuffer.length / 1024).toFixed(0)} KB)`,
      );

      return { sceneNumber: scene.sceneNumber, imagePath };
    };

    const results = await Promise.all(
      inputData.scenes.map((scene) => generateSingleImage(scene)),
    );

    results.sort((a, b) => a.sceneNumber - b.sceneNumber);
    const imagePaths = results.map((r) => r.imagePath);

    logger?.info(
      `✅ [generate-images] All ${imagePaths.length} images generated`,
    );
    return {
      scenes: inputData.scenes,
      audioPaths: inputData.audioPaths,
      imagePaths,
    };
  },
});

const composeVideo = createStep({
  id: "compose-video",
  description:
    "Combines audio narration and scene images into a final MP4 video using FFmpeg with transitions and text overlays",
  inputSchema: z.object({
    scenes: z.array(sceneSchema),
    audioPaths: z.array(z.string()),
    imagePaths: z.array(z.string()),
  }),
  outputSchema: z.object({
    videoPath: z.string(),
    success: z.boolean(),
    durationSeconds: z.number(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🎥 [compose-video] Starting video composition...");

    try {
      execSync("ffmpeg -version", { stdio: "pipe" });
      execSync("ffprobe -version", { stdio: "pipe" });
    } catch {
      const errMsg = "FFmpeg or ffprobe not found. Video composition requires FFmpeg to be installed.";
      logger?.error(`❌ [compose-video] ${errMsg}`);
      throw new Error(errMsg);
    }

    const segmentPaths: string[] = [];
    let totalDuration = 0;

    for (let i = 0; i < inputData.scenes.length; i++) {
      const scene = inputData.scenes[i];
      const audioPath = inputData.audioPaths[i];
      const imagePath = inputData.imagePaths[i];
      const segmentPath = path.join(
        OUTPUT_DIR,
        "scenes",
        `segment-${scene.sceneNumber}.mp4`,
      );

      logger?.info(
        `🎞️ [compose-video] Creating segment ${scene.sceneNumber}: "${scene.title}"`,
      );

      let duration = 10;
      try {
        const probeOutput = execSync(
          `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
          { encoding: "utf-8" },
        ).trim();
        duration = parseFloat(probeOutput) || 10;
      } catch {
        logger?.warn(
          `⚠️ [compose-video] Could not probe audio duration for scene ${scene.sceneNumber}, using ${duration}s`,
        );
      }

      const paddedDuration = duration + 1;
      totalDuration += paddedDuration;

      const escapedTitle = scene.title
        .replace(/'/g, "\\'")
        .replace(/:/g, "\\:");

      try {
        execSync(
          `ffmpeg -y -loop 1 -i "${imagePath}" -i "${audioPath}" ` +
            `-filter_complex "` +
            `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,` +
            `fade=t=in:st=0:d=1,fade=t=out:st=${paddedDuration - 1}:d=1,` +
            `drawtext=text='${escapedTitle}':fontcolor=white:fontsize=42:` +
            `x=(w-text_w)/2:y=h-100:shadowcolor=black:shadowx=2:shadowy=2:` +
            `enable='between(t,0.5,${paddedDuration - 0.5})'[v]` +
            `" ` +
            `-map "[v]" -map 1:a -c:v libx264 -preset fast -crf 23 -tune stillimage ` +
            `-c:a aac -b:a 192k -pix_fmt yuv420p -t ${paddedDuration} "${segmentPath}"`,
          { encoding: "utf-8", stdio: "pipe" },
        );
        segmentPaths.push(segmentPath);
        logger?.info(
          `✅ [compose-video] Segment ${scene.sceneNumber} created (${paddedDuration.toFixed(1)}s)`,
        );
      } catch (err) {
        logger?.error(
          `❌ [compose-video] FFmpeg segment failed for scene ${scene.sceneNumber}`,
          {
            errorMsg: err instanceof Error ? err.message : String(err),
          },
        );
        throw err;
      }
    }

    logger?.info("📦 [compose-video] Concatenating all segments...");

    const concatListPath = path.join(OUTPUT_DIR, "concat-list.txt");
    const concatContent = segmentPaths
      .map((p) => `file '${p}'`)
      .join("\n");
    fs.writeFileSync(concatListPath, concatContent);

    const finalVideoPath = path.join(OUTPUT_DIR, "deepti-journey-video.mp4");

    try {
      execSync(
        `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${finalVideoPath}"`,
        { encoding: "utf-8", stdio: "pipe" },
      );
    } catch (err) {
      logger?.error("❌ [compose-video] FFmpeg concat failed", {
        errorMsg: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const stats = fs.statSync(finalVideoPath);
    logger?.info(
      `✅ [compose-video] Final video created: ${finalVideoPath}`,
    );
    logger?.info(
      `📊 [compose-video] Video size: ${(stats.size / (1024 * 1024)).toFixed(1)} MB, Duration: ~${totalDuration.toFixed(0)}s`,
    );

    return {
      videoPath: finalVideoPath,
      success: true,
      durationSeconds: Math.round(totalDuration),
    };
  },
});

const finalizeOutput = createStep({
  id: "finalize-output",
  description:
    "Logs final summary and confirms the video has been successfully created",
  inputSchema: z.object({
    videoPath: z.string(),
    success: z.boolean(),
    durationSeconds: z.number(),
  }),
  outputSchema: z.object({
    message: z.string(),
    videoPath: z.string(),
    durationSeconds: z.number(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();

    const downloadUrl = "/api/video/latest";

    const summary = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎬 JOURNEY VIDEO GENERATION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 Video saved to: ${inputData.videoPath}
🔗 Download at: ${downloadUrl}
⏱️ Duration: ~${inputData.durationSeconds} seconds
✅ Status: ${inputData.success ? "SUCCESS" : "FAILED"}

This video tells Deepti's inspiring journey from
kidney failure to tech builder, hackathon winner,
and founder of MediMate Foundation.

Message: Don't let transplant or dialysis stop you.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    logger?.info(summary);

    return {
      message: `Journey video generated successfully. Duration: ~${inputData.durationSeconds}s. Download at: ${downloadUrl}`,
      videoPath: inputData.videoPath,
      durationSeconds: inputData.durationSeconds,
    };
  },
});

export const journeyVideoWorkflow = createWorkflow({
  id: "journey-video-workflow",
  inputSchema: z.object({}) as any,
  outputSchema: z.object({
    message: z.string(),
    videoPath: z.string(),
    durationSeconds: z.number(),
  }),
})
  .then(generateScript as any)
  .then(generateAudio as any)
  .then(generateImages as any)
  .then(composeVideo as any)
  .then(finalizeOutput as any)
  .commit();
