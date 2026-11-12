import { generateText } from "ai";
export async function run() {
  const { text } = await generateText({
    model: "gpt",
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "hi" },
    ],
  });
  return text;
}
