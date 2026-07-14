import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_MODEL = process.env.ARK_MODEL || "doubao-seed-1-8-251228";

app.post("/api/recognize-acu", upload.single("image"), async (req, res) => {
  try {
    if (!ARK_API_KEY) {
      return res.json({
        success: false,
        error: "没有配置 ARK_API_KEY，请检查 .env 文件",
      });
    }

    if (!req.file) {
      return res.json({
        success: false,
        error: "没有收到图片",
      });
    }

    const imagePath = req.file.path;
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    const imageDataUrl = `data:${req.file.mimetype};base64,${base64Image}`;

    const response = await fetch(
      "https://ark.cn-beijing.volces.com/api/v3/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ARK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: ARK_MODEL,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: `
你是一个直播数据截图识别助手。

请从这张快手「单场直播分析」截图中识别以下三个字段：

1. 观众人数
2. 人均看播时长，单位是分钟
3. 直播时长，并转换成分钟

识别规则：
- 观众人数通常在「数据分析」区域，字段名叫「观众人数」。
- 人均看播时长通常字段名叫「人均看播时长」。
- 直播时长通常在页面顶部，格式可能是「28分55秒」。
- 如果直播时长是 28分55秒，请转换为 28 + 55 / 60 = 28.917 分钟。
- 如果某个字段无法识别，请返回 null。
- 不要编造。
- 只返回 JSON，不要解释，不要 Markdown。

返回格式必须严格如下：

{
  "viewers": 1935,
  "avgWatchMinutes": 0.1,
  "durationMinutes": 28.917
}
                  `.trim(),
                },
                {
                  type: "input_image",
                  image_url: imageDataUrl,
                },
              ],
            },
          ],
        }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error("火山方舟接口错误：", result);

      fs.unlinkSync(imagePath);

      return res.json({
        success: false,
        error:
          result?.error?.message ||
          result?.message ||
          "火山方舟接口调用失败",
        raw: result,
      });
    }

    console.log("豆包原始返回：", JSON.stringify(result, null, 2));

    const modelText = extractTextFromArkResponse(result);

    if (!modelText) {
      fs.unlinkSync(imagePath);

      return res.json({
        success: false,
        error: "模型没有返回可解析文本",
        raw: result,
      });
    }

    let data;

    try {
      const jsonText = modelText
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      data = JSON.parse(jsonText);
    } catch (e) {
      fs.unlinkSync(imagePath);

      return res.json({
        success: false,
        error: "模型返回的不是合法 JSON",
        raw: modelText,
      });
    }

    const viewers = Number(data.viewers);
    const avgWatchMinutes = Number(data.avgWatchMinutes);
    const durationMinutes = Number(data.durationMinutes);

    let acu = null;

    if (
      Number.isFinite(viewers) &&
      Number.isFinite(avgWatchMinutes) &&
      Number.isFinite(durationMinutes) &&
      durationMinutes > 0
    ) {
      acu = viewers * avgWatchMinutes / durationMinutes;
    }

    fs.unlinkSync(imagePath);

    res.json({
      success: true,
      viewers: Number.isFinite(viewers) ? viewers : null,
      avgWatchMinutes: Number.isFinite(avgWatchMinutes)
        ? avgWatchMinutes
        : null,
      durationMinutes: Number.isFinite(durationMinutes)
        ? durationMinutes
        : null,
      acu: acu === null ? null : Number(acu.toFixed(2)),
    });
  } catch (error) {
    console.error(error);

    res.json({
      success: false,
      error: error.message || "识别失败",
    });
  }
});

function extractTextFromArkResponse(result) {
  if (typeof result.output_text === "string") {
    return result.output_text;
  }

  if (Array.isArray(result.output)) {
    for (const item of result.output) {
      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          if (typeof content.text === "string") {
            return content.text;
          }

          if (typeof content.output_text === "string") {
            return content.output_text;
          }
        }
      }
    }
  }

  if (typeof result.text === "string") {
    return result.text;
  }

  return "";
}

app.listen(3000, () => {
  console.log("ACU 识别服务已启动");
  console.log("请打开：http://localhost:3000");
});
