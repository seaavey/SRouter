import type { ExportLanguage } from "@/components/playground/playground.types";

export interface CodeSnippetParams {
    apiBase: string;
    modelId: string;
    activeChatId: string;
    messages: Array<{ role: string; content: string }>;
}

export function shellQuote(value: string): string {
    return `'${value.replaceAll("'", `"'"'`)}'`;
}

export function generatePlaygroundCodeSnippet(
    lang: ExportLanguage,
    params: CodeSnippetParams
): string {
    const { apiBase, modelId, activeChatId, messages } = params;

    switch (lang) {
        case "curl": {
            const payload = {
                model: modelId,
                messages,
                stream: true
            };
            return `curl ${apiBase}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer YOUR_API_KEY" \\\n  -H "X-Chat-ID: ${activeChatId}" \\\n  -d ${shellQuote(JSON.stringify(payload, null, 2))}`;
        }
        case "typescript": {
            return `import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${apiBase}",
  apiKey: process.env.SROUTER_API_KEY || "YOUR_API_KEY",
  defaultHeaders: {
    "X-Chat-ID": "${activeChatId}",
  },
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: "${modelId}",
    messages: ${JSON.stringify(messages, null, 4)},
    stream: true,
  });

  for await (const chunk of completion) {
    process.stdout.write(chunk.choices[0]?.delta?.content || "");
  }
}

main().catch(console.error);`;
        }
        case "python": {
            return `from openai import OpenAI
import os

client = OpenAI(
    base_url="${apiBase}",
    api_key=os.environ.get("SROUTER_API_KEY", "YOUR_API_KEY"),
    default_headers={"X-Chat-ID": "${activeChatId}"},
)

response = client.chat.completions.create(
    model="${modelId}",
    messages=${JSON.stringify(messages, null, 4)},
    stream=True,
)

for chunk in response:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)`;
        }
        case "fetch": {
            return `const response = await fetch("${apiBase}/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer YOUR_API_KEY",
    "X-Chat-ID": "${activeChatId}",
  },
  body: JSON.stringify({
    model: "${modelId}",
    messages: ${JSON.stringify(messages, null, 4)},
    stream: true,
  }),
});

const data = await response.json();
console.log(data);`;
        }
    }
}
